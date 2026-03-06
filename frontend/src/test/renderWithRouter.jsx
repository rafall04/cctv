import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

export function TestRouter({ children, initialEntries = ['/'] }) {
    return (
        <MemoryRouter
            initialEntries={initialEntries}
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
            {children}
        </MemoryRouter>
    );
}

export function renderWithRouter(ui, options = {}) {
    const { initialEntries = ['/'], ...renderOptions } = options;
    return render(ui, {
        wrapper: ({ children }) => <TestRouter initialEntries={initialEntries}>{children}</TestRouter>,
        ...renderOptions,
    });
}

export default renderWithRouter;
