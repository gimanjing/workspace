// app/actual/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigation } from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { CalendarDays, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

// Recharts
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

/* =========================
   Types
========================= */
interface ShopRow { dept: string | null; loc: number | null }
interface MasterRow { no_mat: string; price: number; quantity: number; category: string | null }
interface ActualRow { no_mat: string; posting_date: string; quantity: number; dept: string | null }
interface ForecastRow { no_mat: string; shop: string | null; quantity: number }

type DeptMode = "all" | "list" | "unassigned";
type MaterialOpt = "all" | "Direct Material" | "Indirect Material" | "Unassigned";
interface FilterState {
  month: number; // 1..12
  year: number;  // e.g., 2025
  deptMode: DeptMode;
  deptSelected?: string;
  material: MaterialOpt;
}
type GraphMode = "Combination" | "Daily Control" | "Accumulative Control";

/* =========================
   Constants
========================= */
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 7 }, (_, i) => THIS_YEAR - 3 + i);
const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" }, { value: 3, label: "March" },
  { value: 4, label: "April" },   { value: 5, label: "May" },      { value: 6, label: "June" },
  { value: 7, label: "July" },    { value: 8, label: "August" },   { value: 9, label: "September" },
  { value: 10, label: "October" },{ value: 11, label: "November" },{ value: 12, label: "December" },
];

/* =========================
   Helpers
========================= */
const fmtDate = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD
function monthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0)); // last day
  return { start, end };
}
function listMonthDates(year: number, month: number): string[] {
  const { start, end } = monthRange(year, month);
  const days = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(fmtDate(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

function safeNumber(n: any, d = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : d;
}

/* =========================
   Page
========================= */
export default function Actual() {
  const now = new Date();
  const [filters, setFilters] = useState<FilterState>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    deptMode: "all",
    material: "all",
  });

  // Dept options from shop.dept
  const [deptOptions, setDeptOptions] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("shop").select("dept").not("dept", "is", null);
      if (!error && data) {
        const unique = Array.from(new Set((data as { dept: string | null }[])
          .map(r => (r.dept ?? "").trim())
          .filter(Boolean))).sort();
        if (!cancelled) setDeptOptions(unique);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Graph mode
  const [graphMode, setGraphMode] = useState<GraphMode>("Combination");

  // Load master + shop maps once (or when needed)
  const [masterMap, setMasterMap] = useState<Record<string, MasterRow>>({});
  const [shopMap, setShopMap] = useState<Record<string, number>>({}); // dept -> loc (1/2)

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [{ data: m, error: em }, { data: s, error: es }] = await Promise.all([
        supabase.from("master").select("no_mat, price, quantity, category"),
        supabase.from("shop").select("dept, loc"),
      ]);
      if (em) console.error(em);
      if (es) console.error(es);
      if (cancel) return;
      const mm: Record<string, MasterRow> = {};
      (m ?? []).forEach((r: any) => {
        if (!r.no_mat) return;
        mm[String(r.no_mat)] = {
          no_mat: String(r.no_mat),
          price: safeNumber(r.price),
          quantity: Math.max(1, safeNumber(r.quantity, 1)), // avoid /0
          category: r.category ?? null,
        };
      });
      setMasterMap(mm);
      const sm: Record<string, number> = {};
      (s ?? []).forEach((r: any) => {
        const dept = (r.dept ?? "").trim();
        if (!dept) return;
        sm[dept] = safeNumber(r.loc, 1);
      });
      setShopMap(sm);
    })();
    return () => { cancel = true; };
  }, []);

  // Load calendar for month (both 1 and 2)
  const [cal1, setCal1] = useState<Record<string, number>>({}); // date -> weight
  const [cal2, setCal2] = useState<Record<string, number>>({});
  const [cal1Total, setCal1Total] = useState(0);
  const [cal2Total, setCal2Total] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { start, end } = monthRange(filters.year, filters.month);
      const startStr = fmtDate(start);
      const endStr = fmtDate(end);

      const q1 = supabase.from("calender1").select("date, working_time, over_time")
        .gte("date", startStr).lte("date", endStr);
      const q2 = supabase.from("calender2").select("date, working_time, over_time")
        .gte("date", startStr).lte("date", endStr);

      const [{ data: c1 }, { data: c2 }] = await Promise.all([q1, q2]);

      if (cancel) return;

      const map1: Record<string, number> = {};
      let tot1 = 0;
      (c1 ?? []).forEach((r: any) => {
        const d = r.date?.slice(0, 10);
        const wt = safeNumber(r.working_time);
        const ot = safeNumber(r.over_time);
        const w = wt + ot;
        if (d) { map1[d] = w; tot1 += w; }
      });

      const map2: Record<string, number> = {};
      let tot2 = 0;
      (c2 ?? []).forEach((r: any) => {
        const d = r.date?.slice(0, 10);
        const wt = safeNumber(r.working_time);
        const ot = safeNumber(r.over_time);
        const w = wt + ot;
        if (d) { map2[d] = w; tot2 += w; }
      });

      setCal1(map1); setCal1Total(tot1);
      setCal2(map2); setCal2Total(tot2);
    })();
    return () => { cancel = true; };
  }, [filters.year, filters.month]);

  // Load actual + forecast for month
  const [actualRows, setActualRows] = useState<ActualRow[]>([]);
  const [forecastRows, setForecastRows] = useState<ForecastRow[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { start, end } = monthRange(filters.year, filters.month);
      const startStr = fmtDate(start);
      const endStr = fmtDate(end);

      const qa = supabase.from("actual")
        .select("no_mat, posting_date, quantity, dept")
        .gte("posting_date", startStr).lte("posting_date", endStr);

      // Forecast assumed monthly qty per (no_mat, shop)
      const qf = supabase.from("forecast")
        .select("no_mat, shop, quantity");

      const [{ data: a }, { data: f }] = await Promise.all([qa, qf]);
      if (cancel) return;

      setActualRows((a ?? []).map((r: any) => ({
        no_mat: String(r.no_mat),
        posting_date: String(r.posting_date).slice(0, 10),
        quantity: safeNumber(r.quantity),
        dept: r.dept ?? null,
      })));

      setForecastRows((f ?? []).map((r: any) => ({
        no_mat: String(r.no_mat),
        shop: r.shop ?? null,
        quantity: safeNumber(r.quantity),
      })));
    })();
    return () => { cancel = true; };
  }, [filters.year, filters.month]);

  // Apply filters + compute daily values
  const graphData = useMemo(() => {
    const dates = listMonthDates(filters.year, filters.month);
    const deptSet = new Set(deptOptions);
    const isDeptAllowed = (rowDept: string | null, rowShop: string | null) => {
      const from = (filters.deptMode === "list") ? (filters.deptSelected ?? "") : "";
      if (filters.deptMode === "all") return true;
      if (filters.deptMode === "list") {
        // actual uses dept, forecast uses shop; both must equal selected
        return (rowDept ? rowDept.trim() === from : false) || (rowShop ? rowShop.trim() === from : false);
      }
      // unassigned
      const v = (rowDept ?? rowShop ?? "").trim();
      return v && !deptSet.has(v);
    };

    const isMaterialAllowed = (no_mat: string) => {
      const m = masterMap[no_mat];
      const cat = (m?.category ?? "").trim();
      if (filters.material === "all") return true;
      if (filters.material === "Unassigned") {
        return !(cat === "Direct Material" || cat === "Indirect Material");
      }
      return cat === filters.material;
    };

    // value per unit helper (price/quantity)
    const vpu = (no_mat: string) => {
      const m = masterMap[no_mat];
      if (!m) return 0;
      return safeNumber(m.price) / Math.max(1, safeNumber(m.quantity, 1));
    };

    // Daily Actual (sum per day)
    const actualByDate: Record<string, number> = {};
    for (const d of dates) actualByDate[d] = 0;

    actualRows.forEach(r => {
      if (!isMaterialAllowed(r.no_mat)) return;
      if (!isDeptAllowed(r.dept, null)) return;
      const d = r.posting_date;
      if (!dates.includes(d)) return; // safety
      actualByDate[d] += r.quantity * vpu(r.no_mat);
    });

    // Daily Forecast (distribute by calendar weight based on shop.loc)
    const forecastByDate: Record<string, number> = {};
    for (const d of dates) forecastByDate[d] = 0;

    forecastRows.forEach(r => {
      if (!isMaterialAllowed(r.no_mat)) return;
      if (!isDeptAllowed(null, r.shop)) return;

      // choose calendar by shop.loc (fallback to cal1)
      const dept = (r.shop ?? "").trim();
      const loc = shopMap[dept] ?? 1;
      const cal = loc === 2 ? cal2 : cal1;
      const total = loc === 2 ? cal2Total : cal1Total;
      const denom = total > 0 ? total : 1;

      const totalValue = r.quantity * vpu(r.no_mat);

      // Distribute across month
      dates.forEach(d => {
        const weight = cal[d] ?? 0;
        const share = weight / denom;
        forecastByDate[d] += totalValue * share;
      });
    });

    // Build rows + cumulative
    let cumA = 0, cumF = 0;
    const rows = dates.map((d) => {
      const a = actualByDate[d] || 0;
      const f = forecastByDate[d] || 0;
      cumA += a;
      cumF += f;
      return {
        date: d.slice(8, 10), // show DD on x-axis
        actual: Number(a.toFixed(2)),
        forecast: Number(f.toFixed(2)),
        cumActual: Number(cumA.toFixed(2)),
        cumForecast: Number(cumF.toFixed(2)),
      };
    });

    return rows;
  }, [filters, deptOptions, actualRows, forecastRows, masterMap, shopMap, cal1, cal2, cal1Total, cal2Total]);

  /* =========================
     UI
  ========================= */
  return (
    <div className="min-h-dvh grid grid-cols-[260px_1fr]">
      <aside className="border-r bg-white dark:bg-slate-900 sticky top-0 h-dvh overflow-y-auto">
        <Navigation />
      </aside>

      <main className="min-w-0 overflow-x-hidden">
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
          <div className="container mx-auto p-6 space-y-6">
            {/* Filters */}
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Filters</CardTitle>
              </CardHeader>
              <CardContent>
                <FiltersUI
                  filters={filters}
                  setFilters={setFilters}
                  deptOptions={deptOptions}
                />
              </CardContent>
            </Card>

            {/* Graph Mode */}
            <Card>
              <CardHeader className="flex items-center justify-between gap-4">
                <CardTitle>Graphs</CardTitle>
                <div className="flex items-center gap-3">
                  <Label>Graph</Label>
                  <Select value={graphMode} onValueChange={(v) => setGraphMode(v as GraphMode)}>
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Combination">Combination</SelectItem>
                      <SelectItem value="Daily Control">Daily Control</SelectItem>
                      <SelectItem value="Accumulative Control">Accumulative Control</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <GraphBlock mode={graphMode} data={graphData} />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

/* =========================
   Filters UI (same behavior you requested)
========================= */
function FiltersUI({
  filters,
  setFilters,
  deptOptions,
}: {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  deptOptions: string[];
}) {
  const now = new Date();
  const [deptOpen, setDeptOpen] = useState(false);
  const monthLabel = useMemo(
    () => MONTHS.find(m => m.value === filters.month)?.label ?? "",
    [filters.month]
  );

  return (
    <div className="grid gap-4 md:grid-cols-12">
      {/* Month selector */}
      <div className="md:col-span-4 space-y-2">
        <Label>Month</Label>
        <div className="flex gap-2">
          <Select value={String(filters.month)} onValueChange={(v) => setFilters(f => ({ ...f, month: Number(v) }))}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map(m => (<SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={String(filters.year)} onValueChange={(v) => setFilters(f => ({ ...f, year: Number(v) }))}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map(y => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setFilters(f => ({ ...f, month: now.getMonth() + 1, year: now.getFullYear() }))}
          >
            <CalendarDays className="h-4 w-4" /> This month
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Applies to both <span className="font-mono">forecast</span> and <span className="font-mono">actual</span> tables.
        </p>
      </div>

      {/* Department mode */}
      <div className="md:col-span-4 space-y-2">
        <Label>Department</Label>
        <div className="flex gap-2">
          <Select
            value={filters.deptMode}
            onValueChange={(v: DeptMode) => setFilters(f => ({ ...f, deptMode: v }))}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="list">List</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
            </SelectContent>
          </Select>

          {/* Dept picker shows only when mode === 'list' */}
          {filters.deptMode === "list" && (
            <Popover open={deptOpen} onOpenChange={setDeptOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className={cn("w-56 justify-between", !filters.deptSelected && "text-muted-foreground")}
                >
                  {filters.deptSelected || "Select department"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-0">
                <Command>
                  <CommandInput placeholder="Search dept..." />
                  <CommandEmpty>No department found.</CommandEmpty>
                  <CommandGroup>
                    {deptOptions.map((dept) => (
                      <CommandItem
                        key={dept}
                        value={dept}
                        onSelect={(v) => { setFilters(f => ({ ...f, deptSelected: v })); setDeptOpen(false); }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", dept === filters.deptSelected ? "opacity-100" : "opacity-0")} />
                        {dept}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Source list from <span className="font-mono">shop.dept</span>; “Unassigned” means rows where
          <span className="font-mono"> actual.dept</span> / <span className="font-mono">forecast.shop</span> are not in
          <span className="font-mono"> shop.dept</span>.
        </p>
      </div>

      {/* Material */}
      <div className="md:col-span-4 space-y-2">
        <Label>Material</Label>
        <Select
          value={filters.material}
          onValueChange={(v: MaterialOpt) => setFilters(f => ({ ...f, material: v }))}
        >
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="Direct Material">Direct Material</SelectItem>
            <SelectItem value="Indirect Material">Indirect Material</SelectItem>
            <SelectItem value="Unassigned">Unassigned</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Based on <span className="font-mono">master.category</span>. “Unassigned” = anything else.
        </p>
      </div>

      {/* Dev aid (remove) */}
      <div className="md:col-span-12">
        <div className="rounded-xl border p-3 text-xs text-muted-foreground font-mono">
          {MONTHS.find(m => m.value === filters.month)?.label} {filters.year}
          {" • "}Dept: {filters.deptMode}{filters.deptMode === "list" && filters.deptSelected ? ` → ${filters.deptSelected}` : ""}
          {" • "}Material: {filters.material}
        </div>
      </div>
    </div>
  );
}

/* =========================
   Graph Block
========================= */
function GraphBlock({ mode, data }: { mode: GraphMode; data: any[] }) {
  if (mode === "Daily Control") {
    return (
      <div className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="actual" name="Actual" />
            <Bar dataKey="forecast" name="Forecast" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (mode === "Accumulative Control") {
    return (
      <div className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="cumActual" name="Cum Actual" />
            <Line type="monotone" dataKey="cumForecast" name="Cum Forecast" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Combination
  return (
    <div className="h-[460px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis yAxisId="left" />
          <YAxis yAxisId="right" orientation="right" />
          <Tooltip />
          <Legend />
          <Bar yAxisId="left" dataKey="actual" name="Actual (Daily)" />
          <Bar yAxisId="left" dataKey="forecast" name="Forecast (Daily)" />
          <Line yAxisId="right" type="monotone" dataKey="cumActual" name="Cum Actual" />
          <Line yAxisId="right" type="monotone" dataKey="cumForecast" name="Cum Forecast" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
