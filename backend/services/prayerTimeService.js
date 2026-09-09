/*
Purpose: Compute the five daily prayer times for a given date + location, with NO external API (fits the
         offline/Cloudflare-idle box). Standard sun-position algorithm (PrayTimes-style): sun declination
         + equation of time -> hour angles for Fajr/Sunrise/Dhuhr/Asr/Maghrib/Isha. Kemenag defaults
         (Fajr 20deg, Isha 18deg, Asr shadow factor 1) + a per-run ikhtiyati (safety minutes) + per-prayer
         offset for local fine-tuning. Output is WIB "HH:MM".
Caller: audioPrayerService (scheduler + preview).
Deps: none (pure math).
MainFuncs: computePrayerTimes.
SideEffects: none.

Accuracy note: matches typical jadwal within ~1 min; the operator VERIFIES against their local Kemenag
schedule via the preview and dials per-prayer offsets. Never claim it IS the official schedule.
*/

const dtr = (d) => (d * Math.PI) / 180;
const rtd = (r) => (r * 180) / Math.PI;
const sin = (d) => Math.sin(dtr(d));
const cos = (d) => Math.cos(dtr(d));
const tan = (d) => Math.tan(dtr(d));
const arcsin = (x) => rtd(Math.asin(x));
const arccos = (x) => rtd(Math.acos(x));
const arctan2 = (y, x) => rtd(Math.atan2(y, x));
const arccot = (x) => rtd(Math.atan(1 / x));
const fixAngle = (a) => { let v = a % 360; if (v < 0) v += 360; return v; };
const fixHour = (h) => { let v = h % 24; if (v < 0) v += 24; return v; };

function julian(year, month, day) {
    let y = year;
    let m = month;
    if (m <= 2) { y -= 1; m += 12; }
    const A = Math.floor(y / 100);
    const B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5;
}

// Sun declination + equation of time (hours) for a Julian day.
function sunPosition(jd) {
    const D = jd - 2451545.0;
    const g = fixAngle(357.529 + 0.98560028 * D);
    const q = fixAngle(280.459 + 0.98564736 * D);
    const L = fixAngle(q + 1.915 * sin(g) + 0.020 * sin(2 * g));
    const e = 23.439 - 0.00000036 * D;
    const decl = arcsin(sin(e) * sin(L));
    const RA = arctan2(cos(e) * sin(L), cos(L)) / 15;
    const eqt = q / 15 - fixHour(RA);
    return { declination: decl, equation: eqt };
}

function midDay(jd, t) {
    return fixHour(12 - sunPosition(jd + t).equation);
}

// Time (hours) the sun is at `angle` below the horizon, relative to noon. ccw = morning side.
function sunAngleTime(jd, t, angle, lat, ccw) {
    const decl = sunPosition(jd + t).declination;
    const noon = midDay(jd, t);
    const inner = (-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat));
    if (inner < -1 || inner > 1) return NaN; // no such event (polar) — guarded by caller
    const a = arccos(inner) / 15;
    return noon + (ccw ? -a : a);
}

function asrTime(jd, t, factor, lat) {
    const decl = sunPosition(jd + t).declination;
    const angle = -arccot(factor + tan(Math.abs(lat - decl)));
    return sunAngleTime(jd, t, angle, lat, false);
}

function hoursToHHMM(hours) {
    if (!Number.isFinite(hours)) return null;
    let h = fixHour(hours + 0.5 / 60); // round to nearest minute
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * @param {{year:number,month:number,day:number}} date  target date (local/WIB calendar day)
 * @param {{lat:number, lon:number, tz?:number, fajrAngle?:number, ishaAngle?:number, asrFactor?:number,
 *          ikhtiyati?:number, offsets?:object}} cfg
 * @returns {{fajr,sunrise,dhuhr,asr,maghrib,isha}} each "HH:MM" (WIB), null if uncomputable.
 */
export function computePrayerTimes(date, cfg) {
    const lat = Number(cfg.lat);
    const lon = Number(cfg.lon);
    const tz = cfg.tz ?? 7;
    const fajrAngle = cfg.fajrAngle ?? 20;
    const ishaAngle = cfg.ishaAngle ?? 18;
    const asrFactor = cfg.asrFactor ?? 1;
    const ikhtiyati = cfg.ikhtiyati ?? 2;      // safety minutes added to all
    const offsets = cfg.offsets || {};          // per-prayer minute nudge {fajr, dhuhr, ...}
    const sunsetAngle = 0.833;                   // standard refraction/horizon dip

    const jd = julian(date.year, date.month, date.day) - lon / (15 * 24);

    // Two iterations converge the time-of-day-dependent sun position.
    let times = { fajr: 5 / 24, dhuhr: 12 / 24, asr: 13 / 24, maghrib: 18 / 24, isha: 18 / 24 };
    for (let i = 0; i < 2; i += 1) {
        times = {
            fajr: sunAngleTime(jd, times.fajr, fajrAngle, lat, true) / 24,
            dhuhr: midDay(jd, times.dhuhr) / 24,
            asr: asrTime(jd, times.asr, asrFactor, lat) / 24,
            maghrib: sunAngleTime(jd, times.maghrib, sunsetAngle, lat, false) / 24,
            isha: sunAngleTime(jd, times.isha, ishaAngle, lat, false) / 24,
        };
    }

    const tzAdjust = tz - lon / 15;
    const finalize = (key, extra = 0) => {
        const hours = times[key] * 24 + tzAdjust + (ikhtiyati + (offsets[key] || 0) + extra) / 60;
        return hoursToHHMM(hours);
    };

    return {
        fajr: finalize('fajr'),
        // sunrise: informational (no ikhtiyati) — dhuhr should be a touch after true noon.
        sunrise: hoursToHHMM(sunAngleTime(jd, times.fajr, sunsetAngle, lat, true) / 24 * 24 + tzAdjust),
        dhuhr: finalize('dhuhr'),
        asr: finalize('asr'),
        maghrib: finalize('maghrib'),
        isha: finalize('isha'),
    };
}

export default { computePrayerTimes };
