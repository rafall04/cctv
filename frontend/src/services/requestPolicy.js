export const REQUEST_POLICY = {
    BLOCKING: 'blocking',
    BACKGROUND: 'background',
    RESUME: 'resume',
    SILENT_PUBLIC: 'silent-public',
};

export function getRequestPolicyConfig(policy = REQUEST_POLICY.BLOCKING, overrides = {}) {
    if (policy === REQUEST_POLICY.BACKGROUND || policy === REQUEST_POLICY.RESUME || policy === REQUEST_POLICY.SILENT_PUBLIC) {
        return {
            skipGlobalErrorNotification: true,
            ...overrides,
        };
    }

    return { ...overrides };
}

export function isQuietRequestPolicy(policy) {
    return policy === REQUEST_POLICY.BACKGROUND
        || policy === REQUEST_POLICY.RESUME
        || policy === REQUEST_POLICY.SILENT_PUBLIC;
}
