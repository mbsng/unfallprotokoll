import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { db, type SyncConflict } from "@/lib/local-db";
import { resolveConflict } from "@/lib/sync-worker";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function SyncStatus() {
  const { t } = useTranslation();
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);
  const conflicts = useLiveQuery(() => db.conflicts.orderBy("createdAt").toArray(), [], []);
  const [online, setOnline] = useState(navigator.onLine);
  const conflict = conflicts[0];

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const statusClass = !online
    ? "border-amber-300 bg-amber-50 text-amber-900"
    : pending > 0
      ? "border-blue-200 bg-blue-50 text-blue-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <>
      <div className={`fixed right-3 top-3 z-50 flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-sm ${statusClass}`} role="status" aria-live="polite">
        {!online ? <CloudOff className="h-4 w-4" /> : pending > 0 ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        <span>{!online ? t("sync.offline", { count: pending }) : pending > 0 ? t("sync.pending", { count: pending }) : t("sync.synced")}</span>
      </div>

      <AlertDialog open={Boolean(conflict)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-800"><AlertTriangle className="h-5 w-5" /></span>
            <AlertDialogTitle>{t("sync.conflictTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("sync.conflictDescription", { field: conflict?.field })}</AlertDialogDescription>
          </AlertDialogHeader>
          {conflict && <ConflictValues conflict={conflict} />}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => conflict && void resolveConflict(conflict, "server")}>{t("sync.useServer")}</AlertDialogCancel>
            <AlertDialogAction asChild><Button onClick={() => conflict && void resolveConflict(conflict, "local")} className="bg-[#153B66]">{t("sync.useLocal")}</Button></AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ConflictValues({ conflict }: { conflict: SyncConflict }) {
  const { t } = useTranslation();
  const display = (value: unknown) => typeof value === "string" ? value || "—" : JSON.stringify(value);
  return <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-blue-50 p-3"><p className="text-xs font-bold uppercase text-blue-700">{t("sync.localValue")}</p><p className="mt-1 break-words text-sm text-blue-950">{display(conflict.localValue)}</p></div><div className="rounded-xl bg-slate-100 p-3"><p className="text-xs font-bold uppercase text-slate-600">{t("sync.serverValue")}</p><p className="mt-1 break-words text-sm text-slate-900">{display(conflict.serverValue)}</p></div></div>;
}
