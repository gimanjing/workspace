"use client";

import { useEffect, useState } from "react";
import readXlsxFile from "read-excel-file";
import { supabase } from "@/lib/supabase";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/* ---------- Types ---------- */
type ActualRow = {
  no_mat: string;
  dept: string;                 // always a string now (mapped or "Unassigned")
  quantity: number | null;
  posting_date: string;
  document_date: string;
};

type MasterRow = {
  no_mat: string;
  mat_name: string;
  category: string;
  qty: number | null;
  Price: number | null;
  UoM: string;
  created_at?: string;
  updated_at?: string;
};

/* ---------- Config ---------- */
const DEFAULT_DEPT = "Unassigned";

/* ---------- Helpers ---------- */
function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function excelSerialToYmd(n: number) {
  const ms = (n - 25569) * 86400000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toYmd(v: string | number | Date | null | undefined) {
  if (v == null) return "";
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number") return excelSerialToYmd(v);
  const s = String(v).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${mo}-${dd}`;
  }
  return s;
}

// only .xlsx up to 8 MB
const ALLOWED_EXT = [".xlsx"];
const MAX_BYTES = 8 * 1024 * 1024;
function isAllowedExcel(file: File) {
  const name = file.name.toLowerCase();
  const extOk = ALLOWED_EXT.some((e) => name.endsWith(e));
  const sizeOk = file.size <= MAX_BYTES;
  const mimeOk =
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || file.type === "";
  return extOk && sizeOk && mimeOk;
}

// Parse first sheet → { headers, rows }
async function parseExcel(file: File): Promise<{ headers: string[]; rows: any[][] }> {
  const rows = await readXlsxFile(file, { sheet: 1 });
  if (!rows?.length) return { headers: [], rows: [] };
  const [headerRow, ...rest] = rows;
  const headers = (headerRow ?? []).map((h: any) => String(h ?? "").trim());
  return { headers, rows: rest as any[][] };
}

function chunk<T>(arr: T[], size = 500) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function nextMonthStart(dateYmd: string) {
  const [y, m] = dateYmd.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/* ---------- Page ---------- */
export default function Actual() {
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [preview, setPreview] = useState<ActualRow[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshMissingList();
  }, []);

  function mapHeaders(headers: string[]) {
    const idx: Record<"material" | "cost center" | "total quantity" | "posting date" | "document date", number> = {
      "material": -1,
      "cost center": -1,
      "total quantity": -1,
      "posting date": -1,
      "document date": -1,
    };
    headers.forEach((h, i) => {
      const n = normalizeHeader(h);
      if (n === "material") idx["material"] = i;
      else if (n === "cost center") idx["cost center"] = i;
      else if (n === "total quantity") idx["total quantity"] = i;
      else if (n === "posting date") idx["posting date"] = i;
      else if (n === "document date") idx["document date"] = i;
    });
    return idx;
  }

  // Fetch shop.code -> shop.dept mapping (exact match on code)
  async function fetchDeptMap(codes: string[]) {
    if (!codes.length) return {};
    const unique = Array.from(new Set(codes.filter(Boolean)));
    const { data, error } = await supabase.from("shop").select("code, dept").in("code", unique);
    if (error) throw error;
    const map: Record<string, string> = {};
    (data ?? []).forEach((r: any) => {
      if (r?.code) map[String(r.code).trim()] = r?.dept ? String(r.dept).trim() : DEFAULT_DEPT;
    });
    return map;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview([]);
    setMissing([]);
    if (!f) return;

    if (!isAllowedExcel(f)) {
      toast.error("Invalid file. Only .xlsx up to 8MB is allowed.");
      return;
    }

    try {
      const { headers, rows } = await parseExcel(f);
      if (headers.length === 0) throw new Error("No header row found");
      const idx = mapHeaders(headers);

      const required = ["material", "cost center", "total quantity", "posting date", "document date"] as const;
      const missingHdr = required.filter((k) => idx[k] === -1);
      if (missingHdr.length) throw new Error(`Missing columns: ${missingHdr.join(", ")}`);

      // collect all cost center codes in the file
      const rawCodes = rows
        .map((r) => String(r[idx["cost center"]] ?? "").trim())
        .filter(Boolean);

      // fetch code->dept map from `shop`
      const deptMap = await fetchDeptMap(rawCodes);

      const out: ActualRow[] = [];
      let unmapped = 0;

      for (const r of rows) {
        if (!r || r.length === 0) continue;

        const material = String(r[idx["material"]] ?? "").trim();
        if (!material) continue;

        const costCenterRaw = String(r[idx["cost center"]] ?? "").trim();
        const mappedDept = costCenterRaw
          ? (deptMap[costCenterRaw] ?? DEFAULT_DEPT)   // not found → "Unassigned"
          : DEFAULT_DEPT;                              // blank cell → "Unassigned"

        if (costCenterRaw && !(costCenterRaw in deptMap)) unmapped++;

        const qtyRaw = r[idx["total quantity"]];
        const qtmp = String(qtyRaw ?? "").replace(/,/g, "").trim();
        const n = qtmp ? Number(qtmp) : null;
        const quantity = n != null && Number.isNaN(n) ? null : n;

        const posting_date = toYmd(r[idx["posting date"]] as any);
        const document_date = toYmd(r[idx["document date"]] as any);

        out.push({
          no_mat: material,
          dept: mappedDept,   // <-- final dept that will be inserted into `actual`
          quantity,
          posting_date,
          document_date,
        });
      }

      toast.success(
        `Loaded ${out.length} rows from ${f.name}` +
        (unmapped ? ` — ${unmapped} code(s) not in shop` : "")
      );
      setPreview(out);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Failed to read Excel");
    }
  }

  async function importNow() {
    if (!preview.length) {
      toast.error("No prepared rows to import.");
      return;
    }
    setBusy(true);
    try {
      // Purge affected months
      const months = new Set<string>();
      for (const r of preview) {
        const base = r.posting_date || r.document_date;
        if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(base)) continue;
        months.add(base.slice(0, 7));
      }
      for (const ym of months) {
        const start = `${ym}-01`;
        const next = nextMonthStart(start);
        const { error: delErr } = await supabase
          .from("actual")
          .delete()
          .gte("posting_date", start)
          .lt("posting_date", next);
        if (delErr) throw new Error(`Purge ${ym} failed: ${delErr.message}`);
      }

      // Insert in chunks
      for (const group of chunk(preview, 500)) {
        const { error } = await supabase.from("actual").insert(group);
        if (error) throw new Error(`Insert failed: ${error.message}`);
      }

      await refreshMissingList();
      toast.success(`Imported ${preview.length} rows & refreshed missing list`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function addToMaster(payload: MasterRow) {
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from("master").insert({
        no_mat: payload.no_mat,
        mat_name: payload.mat_name,
        category: payload.category,
        qty: payload.qty,
        Price: payload.Price,
        UoM: payload.UoM,
        created_at: now,
        updated_at: now,
      });
      if (error) throw new Error(error.message);
      setMissing((prev) => prev.filter((m) => m !== payload.no_mat));
      toast.success(`Added ${payload.no_mat} to master`);
    } catch (e: any) {
      toast.error(e?.message ?? "Insert failed");
    }
  }

  async function refreshMissingList() {
    try {
      const { data: actualData, error: err1 } = await supabase.from("actual").select("no_mat");
      if (err1) throw err1;
      const { data: masterData, error: err2 } = await supabase.from("master").select("no_mat");
      if (err2) throw err2;

      const masterSet = new Set((masterData ?? []).map((m) => m.no_mat));
      const missingList = Array.from(new Set((actualData ?? []).map((a) => a.no_mat))).filter(
        (x) => !masterSet.has(x)
      );

      setMissing(missingList);
      toast.success(`Missing list refreshed — ${missingList.length} item(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to refresh list");
    }
  }

  /* ---------- JSX ---------- */
  return (
    <div className="min-h-dvh grid grid-cols-[260px_1fr]">
      <aside className="border-r bg-white dark:bg-slate-900 sticky top-0 h-dvh overflow-y-auto">
        <Navigation />
      </aside>

      <main className="min-w-0 overflow-x-hidden">
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Actual — Upload & Import</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="file">Excel file (.xlsx only)</Label>
                    <Input
                      key={fileKey}
                      id="file"
                      type="file"
                      accept=".xlsx"
                      onChange={handleFile}
                      className="w-80"
                    />
                    {file && (
                      <div className="text-xs text-slate-500 mt-1">
                        Selected: <span className="font-medium">{file.name}</span>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFile(null);
                      setPreview([]);
                      setMissing([]);
                      setFileKey((k) => k + 1);
                    }}
                  >
                    Clear
                  </Button>
                  <Button onClick={importNow} disabled={!preview.length || busy}>
                    {busy ? "Importing…" : "Purge month(s) & Import"}
                  </Button>
                </div>

                {preview.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm text-slate-600 dark:text-slate-300">
                      Prepared <b>{preview.length}</b> rows. Showing first 20:
                    </div>
                    <div className="border rounded-lg overflow-auto max-h-[50vh]">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                          <tr>
                            <th className="px-3 py-2 text-left">no_mat</th>
                            <th className="px-3 py-2 text-left">dept</th>
                            <th className="px-3 py-2 text-right">quantity</th>
                            <th className="px-3 py-2 text-left">posting_date</th>
                            <th className="px-3 py-2 text-left">document_date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.slice(0, 20).map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-2 font-mono">{r.no_mat}</td>
                              <td className="px-3 py-2">{r.dept}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{r.quantity ?? ""}</td>
                              <td className="px-3 py-2 tabular-nums">{r.posting_date}</td>
                              <td className="px-3 py-2 tabular-nums">{r.document_date}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Materials missing in master</CardTitle>
                <Button size="sm" variant="outline" onClick={refreshMissingList}>
                  Refresh Missing List
                </Button>
              </CardHeader>
              <CardContent>
                {missing.length === 0 ? (
                  <div className="text-sm text-slate-500">No missing items. Import or refresh data first.</div>
                ) : (
                  <div className="border rounded-lg overflow-auto max-h-[60vh]">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                        <tr>
                          <th className="px-3 py-2 text-left w-40">no_mat</th>
                          <th className="px-3 py-2 text-left w-64">mat_name</th>
                          <th className="px-3 py-2 text-left w-48">category</th>
                          <th className="px-3 py-2 text-right w-20">qty</th>
                          <th className="px-3 py-2 text-right w-24">Price</th>
                          <th className="px-3 py-2 text-left w-20">UoM</th>
                          <th className="px-3 py-2 text-center w-32">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {missing.map((no_mat) => (
                          <MissingRow key={no_mat} no_mat={no_mat} onAdd={addToMaster} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ---------- MissingRow Component ---------- */
function MissingRow({
  no_mat,
  onAdd,
}: {
  no_mat: string;
  onAdd: (payload: MasterRow) => Promise<void>;
}) {
  const [mat_name, setMatName] = useState("");
  const [category, setCategory] = useState("");
  const [qty, setQty] = useState<number | null>(null);
  const [Price, setPrice] = useState<number | null>(null);
  const [UoM, setUoM] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <tr className="border-t">
      <td className="px-3 py-2 font-mono">{no_mat}</td>
      <td className="px-3 py-2">
        <Input value={mat_name} onChange={(e) => setMatName(e.target.value)} placeholder="mat_name" />
      </td>
      <td className="px-3 py-2">
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="category" />
      </td>
      <td className="px-3 py-2">
        <Input
          type="number"
          value={qty ?? ""}
          onChange={(e) => setQty(e.target.value ? Number(e.target.value) : null)}
          placeholder="qty"
          className="w-24 text-right"
        />
      </td>
      <td className="px-3 py-2">
        <Input
          type="number"
          value={Price ?? ""}
          onChange={(e) => setPrice(e.target.value ? Number(e.target.value) : null)}
          placeholder="Price"
          className="w-28 text-right"
        />
      </td>
      <td className="px-3 py-2">
        <Input value={UoM} onChange={(e) => setUoM(e.target.value)} placeholder="UoM" className="w-24" />
      </td>
      <td className="px-3 py-2 text-center">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd({ no_mat, mat_name, category, qty, Price, UoM });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : "Add"}
        </Button>
      </td>
    </tr>
  );
}
