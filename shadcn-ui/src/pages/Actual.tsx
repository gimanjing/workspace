"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

/** DB row shape */
type ActualRow = {
  no_mat: string;
  dept: string | null;
  quantity: number | null;
  posting_date: string;   // YYYY-MM-DD
  document_date: string;  // YYYY-MM-DD
};

type MasterRow = { no_mat: string; dept?: string | null };

/* ---------- Excel / CSV parsing helpers ---------- */

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

// support Excel serials if they sneak through
function excelSerialToYmd(n: number) {
  // Excel serial: days since 1899-12-30
  const ms = (n - 25569) * 86400000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toYmd(v: string | number | null | undefined) {
  if (v == null) return "";
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
  // last resort: try to parse dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${mo}-${d}`;
  }
  return s; // may fail at DB if truly invalid
}

async function parseExcel(file: File): Promise<{ headers: string[]; rows: any[][] }> {
  // dynamic CDN import – no npm install needed
  const XLSX = await import("https://esm.sh/xlsx@0.18.5");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const wsName = wb.SheetNames[0];
  if (!wsName) return { headers: [], rows: [] };
  const ws = wb.Sheets[wsName];
  // header:1 → array-of-arrays, raw:false gives formatted strings for dates
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  if (!aoa || aoa.length === 0) return { headers: [], rows: [] };
  const headers = (aoa[0] ?? []).map((h: any) => String(h ?? "").trim());
  const rows = aoa.slice(1);
  return { headers, rows };
}

function chunk<T>(arr: T[], size = 500) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function monthStart(dateYmd: string) {
  const [y, m] = dateYmd.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
function nextMonthStart(dateYmd: string) {
  const [y, m] = dateYmd.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/* ---------- Page ---------- */

export default function Actual() {
  const [_now] = useState(useMemo(() => new Date(), [])); // keep for future filters
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ActualRow[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Fixed header mapping (case-insensitive):
  // Material -> no_mat
  // Cost Center -> dept
  // Total Quantity -> quantity
  // Posting Date -> posting_date
  // Document Date -> document_date
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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview([]);
    setMissing([]);
    if (!f) return;

    try {
      const { headers, rows } = await parseExcel(f);
      if (headers.length === 0) throw new Error("No header row found");
      const idx = mapHeaders(headers);

      const required = ["material", "cost center", "total quantity", "posting date", "document date"] as const;
      const missingHdr = required.filter((k) => idx[k] === -1);
      if (missingHdr.length) {
        throw new Error(
          `Missing columns in Excel: ${missingHdr.join(
            ", "
          )}. Found headers: ${headers.join(", ")}`
        );
      }

      const out: ActualRow[] = [];
      for (const r of rows) {
        if (!r || r.length === 0) continue;
        const material = String(r[idx["material"]] ?? "").trim();
        const dept = String(r[idx["cost center"]] ?? "").trim();
        const qtyRaw = r[idx["total quantity"]];
        const postingRaw = r[idx["posting date"]];
        const docRaw = r[idx["document date"]];

        if (!material) continue;

        const quantity =
          qtyRaw == null || String(qtyRaw).trim() === "" ? null : Number(String(qtyRaw).replace(/,/g, ""));
        const posting_date = toYmd(postingRaw);
        const document_date = toYmd(docRaw);

        out.push({
          no_mat: material,
          dept: dept || null,
          quantity,
          posting_date,
          document_date,
        });
      }

      if (out.length === 0) {
        toast.warning("No valid rows found.");
      } else {
        toast.success(`Loaded ${out.length} rows from ${f.name}`);
      }
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
      // Determine unique months from posting_date (fallback to document_date if empty)
      const months = new Set<string>();
      for (const r of preview) {
        const base = r.posting_date || r.document_date;
        if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(base)) continue;
        const ym = base.slice(0, 7); // YYYY-MM
        months.add(ym);
      }

      // Purge old data for EACH month (posting_date in that month)
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

      // Insert new rows (chunked)
      for (const group of chunk(preview, 500)) {
        const { error } = await supabase.from("actual").insert(group);
        if (error) throw new Error(`Insert failed: ${error.message}`);
      }

      // Check which no_mat are NOT in master
      const uniqueMats = Array.from(new Set(preview.map((r) => r.no_mat)));
      const present = new Set<string>();
      for (const group of chunk(uniqueMats, 1000)) {
        const { data, error } = await supabase.from("master").select("no_mat").in("no_mat", group);
        if (error) throw new Error(`Master check failed: ${error.message}`);
        (data ?? []).forEach((row: MasterRow) => present.add(row.no_mat));
      }
      const missingList = uniqueMats.filter((m) => !present.has(m));
      setMissing(missingList);

      toast.success(
        `Imported ${preview.length} rows. Purged ${months.size} month(s). Missing in master: ${missingList.length}`
      );
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function addToMaster(no_mat: string, dept?: string) {
    try {
      const payload: MasterRow = { no_mat, dept: (dept ?? "").trim() || null };
      const { error } = await supabase.from("master").insert(payload);
      if (error) throw new Error(error.message);
      setMissing((prev) => prev.filter((m) => m !== no_mat));
      toast.success(`Added ${no_mat} to master`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add to master");
    }
  }

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
                    <Label htmlFor="file">Excel file (.xlsx / .xls)</Label>
                    <Input
                      id="file"
                      type="file"
                      accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={handleFile}
                      className="w-80"
                    />
                  </div>

                  <Button variant="outline" onClick={() => { setFile(null); setPreview([]); setMissing([]); }}>
                    Clear
                  </Button>

                  <Button onClick={importNow} disabled={!preview.length || busy}>
                    {busy ? "Importing…" : "Purge month(s) & Import"}
                  </Button>

                  <div className="text-xs text-slate-500">
                    We will purge old rows by <code>posting_date</code> month(s) present in this file, then insert the new rows.
                  </div>
                </div>

                {preview.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm text-slate-600 dark:text-slate-300">
                      Prepared <b>{preview.length}</b> rows from <b>{file?.name}</b>. Showing first 20:
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
                              <td className="px-3 py-2">{r.no_mat}</td>
                              <td className="px-3 py-2">{r.dept ?? ""}</td>
                              <td className="px-3 py-2 text-right">{r.quantity ?? ""}</td>
                              <td className="px-3 py-2">{r.posting_date}</td>
                              <td className="px-3 py-2">{r.document_date}</td>
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
              <CardHeader>
                <CardTitle>Materials missing in master</CardTitle>
              </CardHeader>
              <CardContent>
                {missing.length === 0 ? (
                  <div className="text-sm text-slate-500">No missing items. Import some data first.</div>
                ) : (
                  <div className="border rounded-lg overflow-auto max-h-[60vh]">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                        <tr>
                          <th className="px-3 py-2 text-left w-64">no_mat</th>
                          <th className="px-3 py-2 text-left w-64">dept (optional)</th>
                          <th className="px-3 py-2 text-left w-40">Action</th>
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

/* Row component for adding an item to master */
function MissingRow({
  no_mat,
  onAdd,
}: {
  no_mat: string;
  onAdd: (no_mat: string, dept?: string) => Promise<void>;
}) {
  const [dept, setDept] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <tr className="border-t">
      <td className="px-3 py-2">{no_mat}</td>
      <td className="px-3 py-2">
        <Input
          placeholder="dept (optional)"
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          className="w-64"
        />
      </td>
      <td className="px-3 py-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            try {
              setBusy(true);
              await onAdd(no_mat, dept);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : "Add to master"}
        </Button>
      </td>
    </tr>
  );
}
