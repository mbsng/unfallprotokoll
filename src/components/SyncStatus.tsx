import { AlertTriangle } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { db, type SyncConflict } from "@/lib/local-db";
import { resolveConflict } from "@/lib/sync-worker";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function SyncStatus({ ownerId }: { ownerId: string | null }) {
  const { t } = useTranslation();
  const conflicts = useLiveQuery(() => ownerId ? db.conflicts.where("ownerId").equals(ownerId).sortBy("createdAt") : [], [ownerId], []);
  const conflict = conflicts[0];

  return (
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
  );
}

function ConflictValues({ conflict }: { conflict: SyncConflict }) {
  const { t } = useTranslation();
  const display = (value: unknown) => typeof value === "string" ? value || "—" : JSON.stringify(value);
  return <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-blue-50 p-3"><p className="text-xs font-bold uppercase text-blue-700">{t("sync.localValue")}</p><p className="mt-1 break-words text-sm text-blue-950">{display(conflict.localValue)}</p></div><div className="rounded-xl bg-slate-100 p-3"><p className="text-xs font-bold uppercase text-slate-600">{t("sync.serverValue")}</p><p className="mt-1 break-words text-sm text-slate-900">{display(conflict.serverValue)}</p></div></div>;
}
