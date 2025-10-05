// src/App.jsx
import React, { useEffect, useState } from "react";

// Layout & chrome
import ErrorBoundary from "./components/common/ErrorBoundary";
import Header from "./components/layout/Header";
import NotificationBar from "./components/layout/NotificationBar";
import TabBtn from "./components/common/TabBtn";

// Hooks
import { useFilters } from "./hooks/useFilters";
import { useChartData } from "./hooks/useChartData";

// Feature panels
import StrategyPanel from "./features/strategy/StrategyPanel";
import GeneratorPanel from "./features/generator/GeneratorPanel";
import FiltersPanel from "./features/filters/FiltersPanel";
import ResultsPanel from "./features/results/ResultsPanel";
import OptimizationPanel from "./features/optimization/OptimizationPanel";
import PortfolioPanel from "./features/portfolio/PortfolioPanel";
import LivePanel from "./features/live/LivePanel";
import SetupPanel from "./features/setup/SetupPanel";

export default function App() {
  const [tab, setTab] = useState("strategy");
  const [notice, setNotice] = useState(""); // NotificationBar text

  // Optional: global filters state (used by FiltersPanel & StrategyPanel if needed)
  const filters = useFilters();

  // Optional: global chart cache (Results/Portfolio may reuse)
  const chart = useChartData();

  // Allow other panels to force-switch to Results after a run
  useEffect(() => {
    const toResults = () => setTab("results");
    window.addEventListener("tab:results", toResults);
    return () => window.removeEventListener("tab:results", toResults);
  }, []);

  // Clear notice after a while
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-900 text-gray-100">
        <Header />

        {/* Tabs */}
        <div className="px-4 pt-4 flex flex-wrap gap-2">
          <TabBtn active={tab === "strategy"} onClick={() => setTab("strategy")}>Strategy</TabBtn>
          <TabBtn active={tab === "generator"} onClick={() => setTab("generator")}>Generator</TabBtn>
          <TabBtn active={tab === "filters"} onClick={() => setTab("filters")}>Filters</TabBtn>
          <TabBtn active={tab === "results"} onClick={() => setTab("results")}>Results</TabBtn>
          <TabBtn active={tab === "optimization"} onClick={() => setTab("optimization")}>Optimization</TabBtn>
          <TabBtn active={tab === "portfolio"} onClick={() => setTab("portfolio")}>Portfolio</TabBtn>
          <TabBtn active={tab === "live"} onClick={() => setTab("live")}>Live</TabBtn>
          
        </div>

        <NotificationBar message={notice} onClose={() => setNotice("")} />

        {/* Panels */}
        <main className="p-4 space-y-6">
          {tab === "strategy" && (
            <StrategyPanel setNotice={setNotice} />
          )}

          {tab === "generator" && (
            <GeneratorPanel setNotice={setNotice} />
          )}

          {tab === "filters" && (
            <FiltersPanel filters={filters} setNotice={setNotice} />
          )}

          {tab === "results" && (
            <ResultsPanel chart={chart} />
          )}

          {tab === "optimization" && (
            <OptimizationPanel setNotice={setNotice} />
          )}

          {tab === "portfolio" && (
            <PortfolioPanel chart={chart} setNotice={setNotice} />
          )}

          {tab === "live" && (
            <LivePanel setNotice={setNotice} />
          )}

        
        </main>
      </div>
    </ErrorBoundary>
  );
}
