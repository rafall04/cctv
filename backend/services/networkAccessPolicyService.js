/**
 * Purpose: Resolve and evaluate ASN-based network access policy for live and playback viewing.
 * Caller: viewerSessionService, playbackViewerSessionService, admin network policy routes.
 * Deps: connectionPool, cameras table, asn_access_policies table.
 * MainFuncs: normalizeAsnList, buildPolicyPayload, listPolicies, upsertPolicy, getEffectivePolicy, enforceAccess.
 * SideEffects: Reads and writes policy rows and throws 403 errors when enforcement denies a request.
 */

import { execute, query, queryOne } from '../database/connectionPool.js';

const POLICY_MODES = new Set(['observe_only', 'allowlist', 'denylist']);
const ACCESS_FLOWS = new Set(['live', 'playback']);
const POLICY_SCOPES = new Set(['global', 'area', 'camera']);

export const DEFAULT_ASN_POLICY = Object.freeze({
    enabled: true,
    mode: 'observe_only',
    asnAllowlist: [],
    asnDenylist: [],
    scope: 'global',
    targetId: null,
    accessFlow: 'live',
});

export function normalizeAsnList(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => Number.parseInt(item, 10))
            .filter((item) => Number.isInteger(item) && item > 0);
    }

    if (typeof value !== 'string') {
        return [];
    }

    const trimmedValue = value.trim();
    if (trimmedValue.startsWith('[')) {
        try {
            return normalizeAsnList(JSON.parse(trimmedValue));
        } catch {
            return [];
        }
    }

    return value
        .split(/[\s,]+/)
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isInteger(item) && item > 0);
}

export function normalizePolicyMode(value) {
    return POLICY_MODES.has(value) ? value : 'observe_only';
}

export function normalizeAccessFlow(value) {
    return ACCESS_FLOWS.has(value) ? value : 'live';
}

export function normalizePolicyScope(value) {
    return POLICY_SCOPES.has(value) ? value : 'global';
}

export function normalizePolicy(row = {}, fallback = DEFAULT_ASN_POLICY) {
    return {
        enabled: row.enabled === undefined ? fallback.enabled : row.enabled !== 0 && row.enabled !== false,
        mode: normalizePolicyMode(row.mode || fallback.mode),
        asnAllowlist: normalizeAsnList(row.asn_allowlist ?? row.asnAllowlist ?? fallback.asnAllowlist),
        asnDenylist: normalizeAsnList(row.asn_denylist ?? row.asnDenylist ?? fallback.asnDenylist),
        scope: row.scope || fallback.scope,
        targetId: row.target_id ?? row.targetId ?? fallback.targetId,
        accessFlow: normalizeAccessFlow(row.access_flow || row.accessFlow || fallback.accessFlow),
    };
}

export function evaluateAsnPolicy(identity = {}, policy = DEFAULT_ASN_POLICY) {
    const normalizedPolicy = normalizePolicy(policy);
    const asnNumber = Number.parseInt(identity.asnNumber, 10);

    if (!normalizedPolicy.enabled) {
        return { allowed: true, reason: 'disabled', policy: normalizedPolicy };
    }

    if (normalizedPolicy.mode === 'observe_only') {
        return { allowed: true, reason: 'observe_only', policy: normalizedPolicy };
    }

    if (!Number.isInteger(asnNumber) || asnNumber <= 0) {
        return {
            allowed: normalizedPolicy.mode !== 'allowlist',
            reason: normalizedPolicy.mode === 'allowlist' ? 'asn_unknown' : 'asn_unknown_not_blocked',
            policy: normalizedPolicy,
        };
    }

    if (normalizedPolicy.mode === 'allowlist') {
        const allowed = normalizedPolicy.asnAllowlist.includes(asnNumber);
        return {
            allowed,
            reason: allowed ? 'allowlisted' : 'asn_not_allowed',
            policy: normalizedPolicy,
        };
    }

    if (normalizedPolicy.mode === 'denylist') {
        const blocked = normalizedPolicy.asnDenylist.includes(asnNumber);
        return {
            allowed: !blocked,
            reason: blocked ? 'asn_blocked' : 'not_blocked',
            policy: normalizedPolicy,
        };
    }

    return { allowed: true, reason: 'default', policy: normalizedPolicy };
}

export function buildPolicyPayload(input = {}) {
    const scope = normalizePolicyScope(input.scope);
    const accessFlow = normalizeAccessFlow(input.accessFlow ?? input.access_flow);
    const targetIdValue = input.targetId ?? input.target_id;
    const targetId = scope === 'global' ? null : Number.parseInt(targetIdValue, 10);

    if (scope !== 'global' && (!Number.isInteger(targetId) || targetId <= 0)) {
        const error = new Error('targetId is required for area and camera policies');
        error.statusCode = 400;
        throw error;
    }

    return {
        scope,
        targetId,
        accessFlow,
        enabled: input.enabled === false || input.enabled === 0 ? 0 : 1,
        mode: normalizePolicyMode(input.mode),
        asnAllowlist: normalizeAsnList(input.asnAllowlist ?? input.asn_allowlist),
        asnDenylist: normalizeAsnList(input.asnDenylist ?? input.asn_denylist),
        description: String(input.description || '').trim() || null,
    };
}

export function serializePolicyRow(row = {}) {
    return {
        id: row.id,
        scope: row.scope,
        targetId: row.target_id ?? null,
        accessFlow: row.access_flow,
        enabled: row.enabled !== 0,
        mode: normalizePolicyMode(row.mode),
        asnAllowlist: normalizeAsnList(row.asn_allowlist),
        asnDenylist: normalizeAsnList(row.asn_denylist),
        description: row.description || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

class NetworkAccessPolicyService {
    listPolicies() {
        return query(`
            SELECT id, scope, target_id, access_flow, enabled, mode,
                   asn_allowlist, asn_denylist, description, created_at, updated_at
            FROM asn_access_policies
            ORDER BY
                CASE scope WHEN 'global' THEN 0 WHEN 'area' THEN 1 ELSE 2 END,
                COALESCE(target_id, 0),
                access_flow
        `).map(serializePolicyRow);
    }

    getPolicyById(id) {
        const policyId = Number.parseInt(id, 10);
        if (!Number.isInteger(policyId) || policyId <= 0) {
            return null;
        }

        const row = queryOne(`
            SELECT id, scope, target_id, access_flow, enabled, mode,
                   asn_allowlist, asn_denylist, description, created_at, updated_at
            FROM asn_access_policies
            WHERE id = ?
        `, [policyId]);

        return row ? serializePolicyRow(row) : null;
    }

    upsertPolicy(input = {}) {
        const payload = buildPolicyPayload(input);
        execute(`
            INSERT INTO asn_access_policies (
                scope, target_id, access_flow, enabled, mode,
                asn_allowlist, asn_denylist, description, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT DO UPDATE SET
                enabled = excluded.enabled,
                mode = excluded.mode,
                asn_allowlist = excluded.asn_allowlist,
                asn_denylist = excluded.asn_denylist,
                description = excluded.description,
                updated_at = CURRENT_TIMESTAMP
        `, [
            payload.scope,
            payload.targetId,
            payload.accessFlow,
            payload.enabled,
            payload.mode,
            JSON.stringify(payload.asnAllowlist),
            JSON.stringify(payload.asnDenylist),
            payload.description,
        ]);

        const row = this.findPolicyRow(payload.scope, payload.targetId, payload.accessFlow);
        return serializePolicyRow(row);
    }

    deletePolicy(id) {
        const policyId = Number.parseInt(id, 10);
        if (!Number.isInteger(policyId) || policyId <= 0) {
            const error = new Error('Invalid policy id');
            error.statusCode = 400;
            throw error;
        }

        const result = execute('DELETE FROM asn_access_policies WHERE id = ?', [policyId]);
        return result.changes > 0;
    }

    getCameraAreaId(cameraId) {
        const row = queryOne('SELECT area_id FROM cameras WHERE id = ?', [cameraId]);
        return row?.area_id ?? null;
    }

    findPolicyRow(scope, targetId, accessFlow) {
        return queryOne(`
            SELECT id, scope, target_id, access_flow, enabled, mode,
                   asn_allowlist, asn_denylist, description, created_at, updated_at
            FROM asn_access_policies
            WHERE scope = ?
              AND COALESCE(target_id, 0) = COALESCE(?, 0)
              AND access_flow = ?
            LIMIT 1
        `, [scope, targetId, accessFlow]);
    }

    findPolicy(scope, targetId, accessFlow) {
        return this.findPolicyRow(scope, targetId, accessFlow);
    }

    getEffectivePolicy({ cameraId = null, accessFlow = 'live' } = {}) {
        const flow = normalizeAccessFlow(accessFlow);
        const fallback = { ...DEFAULT_ASN_POLICY, accessFlow: flow };

        try {
            if (cameraId) {
                const cameraPolicy = this.findPolicy('camera', cameraId, flow);
                if (cameraPolicy) {
                    return normalizePolicy(cameraPolicy, fallback);
                }

                const areaId = this.getCameraAreaId(cameraId);
                if (areaId) {
                    const areaPolicy = this.findPolicy('area', areaId, flow);
                    if (areaPolicy) {
                        return normalizePolicy(areaPolicy, fallback);
                    }
                }
            }

            const globalPolicy = this.findPolicy('global', null, flow);
            if (globalPolicy) {
                return normalizePolicy(globalPolicy, fallback);
            }
        } catch (error) {
            if (!String(error?.message || '').includes('no such table')) {
                throw error;
            }
        }

        return fallback;
    }

    enforceAccess({ cameraId = null, accessFlow = 'live', identity = {} } = {}) {
        const policy = this.getEffectivePolicy({ cameraId, accessFlow });
        const decision = evaluateAsnPolicy(identity, policy);
        if (decision.allowed) {
            return decision;
        }

        const error = new Error('ASN policy denied');
        error.statusCode = 403;
        error.code = 'ASN_POLICY_DENIED';
        error.decision = decision;
        throw error;
    }
}

export default new NetworkAccessPolicyService();
