import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter, createRootRoute, createRoute } from "@tanstack/react-router";
import "./styles/globals.css";

const queryClient = new QueryClient();

function HomePage() {
  return (
    <main className="shell">
      <p className="eyebrow">GENWORX · FINANCE OPERATIONS</p>
      <h1>Accounts Payable Assistant</h1>
      <p className="muted">Project scaffold is running. The command center is the next feature to implement.</p>
      <section className="status-grid">
        <article><span>Documents</span><strong>—</strong><small>Processing pipeline pending</small></article>
        <article><span>Match issues</span><strong>—</strong><small>Matching service pending</small></article>
        <article><span>Overdue bills</span><strong>—</strong><small>Command center pending</small></article>
      </section>
    </main>
  );
}

const rootRoute = createRootRoute();
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });
const routeTree = rootRoute.addChildren([indexRoute]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
