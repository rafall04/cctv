/*
 * Purpose: Provide admin API calls for ASN/ISP network access policy customization.
 * Caller: NetworkAccessPolicyPanel and future admin policy tools.
 * Deps: apiClient.
 * MainFuncs: getPolicies, savePolicy, deletePolicy.
 * SideEffects: Sends authenticated API requests that read/write asn_access_policies.
 */

import apiClient from './apiClient';

export const networkAccessPolicyService = {
    async getPolicies() {
        const response = await apiClient.get('/api/network-access-policies');
        return response.data;
    },

    async savePolicy(policy) {
        const response = await apiClient.put('/api/network-access-policies', policy);
        return response.data;
    },

    async deletePolicy(id) {
        const response = await apiClient.delete(`/api/network-access-policies/${id}`);
        return response.data;
    },
};

export default networkAccessPolicyService;
