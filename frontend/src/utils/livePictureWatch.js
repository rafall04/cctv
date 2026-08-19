/**
 * Purpose: Decide when a live stream is genuinely PLAYING — by proving a picture exists, not by
 *          observing that bytes arrived — and keep watching after that verdict.
 * Caller: VideoPopup, MultiViewVideoItem (extracted from their duplicated startPlaybackCheck).
 * Deps: HTML media element APIs only.
 * MainFuncs: hasPicture, countDecodedFrames, startLivePictureWatch.
 * SideEffects: One interval per watch; cleared by the returned stop().
 *
 * WHY THIS EXISTS
 * ---------------
 * Both players used to declare a stream live on `readyState >= 3 && buffered.length > 0`. That
 * means "the browser accepted bytes", which is NOT the same as "a frame was decoded and shown" —
 * and the gap between those two is exactly where a black screen lives. A device that takes the
 * HEVC bytes and then fails to decode them satisfies the old test perfectly.
 *
 * What made it permanent was the reaction to that verdict: declaring live clears the loading
 * timeout, stops the poll, and every ERROR handler in both players begins with `|| isLive` and
 * returns. So a wrong "live" is not a wrong label that later corrects itself — it disarms every
 * remaining chance to notice, and the viewer keeps a black rectangle marked LIVE forever.
 *
 * So the verdict now needs a picture, and the watch does not end at the verdict.
 */

/** Dimensions are only known once the decoder has actually described a frame. */
export function hasPicture(video) {
    return Boolean(video) && video.videoWidth > 0 && video.videoHeight > 0;
}

/**
 * Frames the decoder has produced, or `null` where the browser will not say.
 *
 * `null` is a real answer and must not be read as zero: Safari exposes neither counter on some
 * versions, and treating "unknown" as "no frames" would tear down streams that are playing fine.
 */
export function countDecodedFrames(video) {
    if (!video) return null;
    const quality = video.getVideoPlaybackQuality?.();
    if (quality && typeof quality.totalVideoFrames === 'number') {
        return quality.totalVideoFrames;
    }
    if (typeof video.webkitDecodedFrameCount === 'number') {
        return video.webkitDecodedFrameCount;
    }
    return null;
}

/** Bytes reached the buffer — necessary for a picture, nowhere near sufficient. */
function hasMediaData(video) {
    return video.readyState >= 3 && video.buffered?.length > 0;
}

/**
 * Watch one <video> and answer exactly one of two questions, then keep answering the second.
 *
 * onPicture()   — data is flowing AND a frame exists. Safe to call this stream live.
 * onNoPicture() — data kept flowing and time kept advancing, but no picture ever appeared
 *                 (or the decoder produced zero frames). A silent decode failure.
 *
 * `requestPlay` is retained from the code this replaces: some browsers land in a paused state at
 * currentTime 0 with data buffered, and need nudging rather than diagnosing.
 */
export function startLivePictureWatch(video, {
    isStale = () => false,
    onPicture,
    onNoPicture,
    requestPlay,
    intervalMs = 500,
    // Generous on purpose. This deadline only starts counting once data is flowing, and a slow
    // phone decoding a 2560x1440 stream can legitimately take several seconds to show frame one.
    // Firing early would turn a slow stream into a false "unsupported" verdict.
    noPictureAfterMs = 15000,
} = {}) {
    if (!video) return () => {};

    let timer = null;
    let dataSince = null;
    let live = false;
    let framesAtVerdict = null;
    let stillTimeAdvancing = null;

    const stop = () => {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    };

    const giveUp = () => {
        stop();
        onNoPicture?.();
    };

    const tick = () => {
        if (isStale()) {
            stop();
            return;
        }

        if (!live) {
            if (!hasMediaData(video)) return;
            if (video.paused && !(video.currentTime > 0)) {
                requestPlay?.(video);
                return;
            }
            if (hasPicture(video)) {
                live = true;
                framesAtVerdict = countDecodedFrames(video);
                stillTimeAdvancing = video.currentTime;
                onPicture?.();
                return;
            }
            if (dataSince === null) dataSince = Date.now();
            if (Date.now() - dataSince >= noPictureAfterMs) giveUp();
            return;
        }

        // Past the verdict. The stream said it was live; make it keep proving it. A decoder that
        // dies mid-stream leaves currentTime advancing while the frame counter stands still —
        // the one shape that produces a black rectangle nothing else in the app would question.
        const frames = countDecodedFrames(video);
        const advanced = video.currentTime > stillTimeAdvancing;
        if (!advanced) return;
        stillTimeAdvancing = video.currentTime;
        if (frames === null || framesAtVerdict === null) return;
        if (frames > framesAtVerdict) {
            framesAtVerdict = frames;
            return;
        }
        giveUp();
    };

    timer = setInterval(tick, intervalMs);
    return stop;
}
