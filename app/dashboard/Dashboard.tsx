"use client";

import { useState } from "react";
import type { DashboardData, Selection } from "./model";
import { formatMonthLabel } from "@/lib/format";
import StatCards from "./StatCards";
import CategoriesTable from "./CategoriesTable";
import HistoryChart from "./HistoryChart";
import RecentActivity from "./RecentActivity";
import UpcomingBills from "./UpcomingBills";
import Drawer from "./Drawer";
import DrawerContent, { drawerHeader } from "./DrawerContent";

// Client orchestrator: owns drill-down state and lays out every dashboard
// section. All heavy aggregation already happened on the server — this only
// renders the finished view-model and routes clicks into the drawer.
export default function Dashboard({ data }: { data: DashboardData }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const header = selection ? drawerHeader(selection, data) : null;

  return (
    <div className="flex flex-col gap-px">
      <section>
        <div className="mb-px flex items-baseline justify-between px-1 pb-3">
          <p className="mini-label">Month to date</p>
          <p className="mini-label">{formatMonthLabel(data.month)}</p>
        </div>
        <StatCards
          summary={data.summary}
          onSelect={(key) => setSelection({ kind: "stat", key })}
        />
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <p className="mini-label">Categories</p>
          <p className="mini-label">vs trailing 3-mo avg</p>
        </div>
        <CategoriesTable
          rows={data.categories}
          onSelect={(categoryId, category) =>
            setSelection({ kind: "category", categoryId, category })
          }
        />
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <p className="mini-label">Spending history</p>
          <p className="mini-label">12 months</p>
        </div>
        <HistoryChart
          series={data.history}
          onSelectCategory={(categoryId, category) =>
            setSelection({ kind: "category", categoryId, category })
          }
        />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-baseline justify-between px-1">
            <p className="mini-label">Recent activity</p>
          </div>
          <RecentActivity
            items={data.recent}
            onSelect={(tx) => setSelection({ kind: "transaction", tx })}
          />
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between px-1">
            <p className="mini-label">Upcoming bills</p>
            <p className="mini-label">projected</p>
          </div>
          <UpcomingBills
            bills={data.bills}
            onSelect={(bill) => setSelection({ kind: "bill", bill })}
          />
        </section>
      </div>

      <Drawer
        open={selection !== null}
        title={header?.title ?? ""}
        subtitle={header?.subtitle}
        onClose={() => setSelection(null)}
      >
        {selection && (
          <DrawerContent
            selection={selection}
            data={data}
            onNavigate={setSelection}
          />
        )}
      </Drawer>
    </div>
  );
}
