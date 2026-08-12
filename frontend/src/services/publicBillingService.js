/*
 * Purpose: Unauthenticated rental price list for the public sales page (/sewa).
 * Caller: pages/SewaPage.jsx.
 * Deps: shared apiClient.
 * MainFuncs: getPublicPlans.
 * SideEffects: HTTP requests only.
 *
 * The backend endpoint exists precisely so sales copy stops hand-typing prices — see
 * controllers/publicBillingController.js for the drift incident that created it. Anything rendering
 * a price must come through here; never re-type a rupiah figure into a component.
 */

import apiClient from './apiClient';

export const publicBillingService = {
    async getPublicPlans() {
        const response = await apiClient.get('/api/public/billing/plans');
        return response.data;
    },
};

export default publicBillingService;
