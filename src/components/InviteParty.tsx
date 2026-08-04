import { useState } from "react";
import { Copy, Share2, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatShareCode, normalizeShareCode } from "@/lib/share-code";

interface InvitePartyProps {
  shareCode?: string | null;
  loading?: boolean;
}

function InviteContent({ shareCode, loading }: InvitePartyProps) {
  const { t } = useTranslation();
  const code = normalizeShareCode(shareCode ?? "");
  const validCode = /^[A-Z0-9]{8}$/.test(code);
  const joinUrl = validCode ? `${window.location.origin}/join/${code}` : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast.success(t("invite.copied"));
    } catch {
      toast.error(t("invite.copyError"));
    }
  };

  const share = async () => {
    if (!navigator.share) {
      await copyLink();
      return;
    }
    try {
      await navigator.share({ title: t("invite.shareTitle"), text: t("invite.shareText", { code: formatShareCode(code) }), url: joinUrl });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copyLink();
    }
  };

  if (!validCode) {
    return <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600">{t(loading ? "invite.loading" : "invite.unavailable")}</div>;
  }

  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto w-fit rounded-2xl border border-slate-300 bg-white p-4 shadow-sm">
        <QRCodeSVG value={joinUrl} size={240} level="M" bgColor="#FFFFFF" fgColor="#0F172A" aria-label={t("summary.qrAlt")} />
      </div>
      <div>
        <p className="font-mono text-4xl font-bold tracking-[0.12em] text-[#153B66]">{formatShareCode(code)}</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("summary.scanHint")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" onClick={() => void copyLink()} className="h-12 rounded-xl border-[#9FBACD] text-[#153B66]"><Copy className="mr-2 h-4 w-4" />{t("invite.copyLink")}</Button>
        <Button type="button" onClick={() => void share()} className="h-12 rounded-xl bg-[#153B66]"><Share2 className="mr-2 h-4 w-4" />{t("invite.share")}</Button>
      </div>
      <p className="flex items-center justify-center gap-2 text-xs leading-relaxed text-slate-500"><Smartphone className="h-4 w-4 shrink-0" />{t("invite.brightnessHint")}</p>
    </div>
  );
}

export function InviteParty({ shareCode, loading }: InvitePartyProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-3xl border border-[#B8CDDC] bg-[#F4F8FB] p-5 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#39719D]">{t("summary.inviteParty")}</p><p className="mt-1 text-sm text-slate-600">{t("invite.description")}</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button type="button" variant="outline" className="rounded-xl border-[#9FBACD] text-[#153B66]">{t("invite.openDialog")}</Button></DialogTrigger>
          <DialogContent className="max-h-[95vh] max-w-md overflow-y-auto">
            <DialogHeader><DialogTitle>{t("summary.inviteParty")}</DialogTitle><DialogDescription>{t("invite.description")}</DialogDescription></DialogHeader>
            <InviteContent shareCode={shareCode} loading={loading} />
          </DialogContent>
        </Dialog>
      </div>
      <InviteContent shareCode={shareCode} loading={loading} />
    </section>
  );
}
