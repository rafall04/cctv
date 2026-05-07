/**
 * Purpose: Resolve client IP addresses into ASN/ISP network identities for access logs and policy checks.
 * Caller: viewerSessionService, playbackViewerSessionService, securityAuditLogger, network access policy checks.
 * Deps: fs/path/url, @maxmind/geoip2-node, optional GEOLITE2_ASN_DB_PATH environment variable.
 * MainFuncs: NetworkIdentityService.resolveIpIdentity, configureReader, clearCache.
 * SideEffects: Reads the local GeoLite2 ASN database when configured and caches IP lookup results in memory.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Reader } from '@maxmind/geoip2-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ASN_DB_PATH = join(__dirname, '..', 'data', 'GeoLite2-ASN.mmdb');
const LOOKUP_SOURCE = 'geolite2_asn';
const UNAVAILABLE = 'unavailable';

function normalizeLookupVersion(value) {
    if (!value) {
        return UNAVAILABLE;
    }
    return String(value);
}

function buildUnknownIdentity(ipAddress, lookupSource = UNAVAILABLE, lookupVersion = UNAVAILABLE) {
    return {
        ipAddress,
        asnNumber: null,
        asnOrg: 'unknown',
        lookupSource,
        lookupVersion,
    };
}

function buildVersionFromFile(dbPath) {
    try {
        return statSync(dbPath).mtime.toISOString().slice(0, 10);
    } catch {
        return UNAVAILABLE;
    }
}

export class NetworkIdentityService {
    constructor({
        reader = null,
        databasePath = process.env.GEOLITE2_ASN_DB_PATH || DEFAULT_ASN_DB_PATH,
        lookupVersion = null,
        logger = console,
    } = {}) {
        this.reader = reader;
        this.databasePath = databasePath;
        this.lookupVersion = normalizeLookupVersion(lookupVersion);
        this.logger = logger;
        this.cache = new Map();
        this.didAttemptDefaultLoad = Boolean(reader);
    }

    configureReader(reader, lookupVersion = null) {
        this.reader = reader;
        this.lookupVersion = normalizeLookupVersion(lookupVersion);
        this.didAttemptDefaultLoad = true;
        this.clearCache();
    }

    clearCache() {
        this.cache.clear();
    }

    ensureReaderLoaded() {
        if (this.reader || this.didAttemptDefaultLoad) {
            return;
        }

        this.didAttemptDefaultLoad = true;
        const resolvedPath = resolve(this.databasePath);
        if (!existsSync(resolvedPath)) {
            return;
        }

        try {
            const dbBuffer = readFileSync(resolvedPath);
            this.reader = Reader.openBuffer(dbBuffer);
            this.lookupVersion = buildVersionFromFile(resolvedPath);
        } catch (error) {
            this.reader = null;
            this.lookupVersion = UNAVAILABLE;
            this.logger.warn?.('[NetworkIdentity] Failed to load GeoLite2 ASN database:', error.message);
        }
    }

    resolveIpIdentity(ipAddress) {
        const normalizedIp = typeof ipAddress === 'string' && ipAddress.trim()
            ? ipAddress.trim()
            : 'unknown';

        if (this.cache.has(normalizedIp)) {
            return this.cache.get(normalizedIp);
        }

        this.ensureReaderLoaded();
        if (!this.reader) {
            const unknownIdentity = buildUnknownIdentity(normalizedIp);
            this.cache.set(normalizedIp, unknownIdentity);
            return unknownIdentity;
        }

        try {
            const response = this.reader.asn(normalizedIp);
            const identity = {
                ipAddress: normalizedIp,
                asnNumber: response.autonomousSystemNumber ?? null,
                asnOrg: response.autonomousSystemOrganization || 'unknown',
                lookupSource: LOOKUP_SOURCE,
                lookupVersion: this.lookupVersion,
            };
            this.cache.set(normalizedIp, identity);
            return identity;
        } catch {
            const unknownIdentity = buildUnknownIdentity(normalizedIp, LOOKUP_SOURCE, this.lookupVersion);
            this.cache.set(normalizedIp, unknownIdentity);
            return unknownIdentity;
        }
    }
}

export default new NetworkIdentityService();
