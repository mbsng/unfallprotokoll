export type AppLocale = "de" | "fr" | "it" | "en";

const messages: Record<AppLocale, Record<string, string>> = {
  de: {
    method_not_allowed: "Diese Anfrage wird nicht unterstützt.",
    unauthorized: "Bitte melden Sie sich erneut an.",
    invalid_incident: "Der angegebene Fall ist ungültig.",
    invalid_request: "Die Anfrage ist unvollständig oder ungültig.",
    not_found: "Der Fall wurde nicht gefunden.",
    forbidden: "Sie haben keinen Zugriff auf diesen Fall.",
    own_signature_required: "Für PDF und Versand muss Ihre eigene Unterschrift gespeichert sein.",
    verified_email_required: "Für den Versand wird eine bestätigte E-Mail-Adresse benötigt.",
    invalid_destination: "Der Versand ist nur an Ihre eigene bestätigte E-Mail-Adresse möglich.",
    rate_limit_failed: "Die Versandbegrenzung konnte nicht geprüft werden. Bitte versuchen Sie es erneut.",
    too_many_submissions: "Zu viele Versandversuche. Bitte versuchen Sie es später erneut.",
    pdf_generation_failed: "Das PDF konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
    email_provider_not_configured: "Der E-Mail-Versand ist noch nicht konfiguriert.",
    email_send_failed: "Die E-Mail konnte nicht versendet werden. Bitte versuchen Sie es später erneut.",
    submission_failed: "Das Protokoll konnte nicht versendet werden. Bitte versuchen Sie es erneut.",
  },
  fr: {
    method_not_allowed: "Cette requête n’est pas prise en charge.",
    unauthorized: "Veuillez vous reconnecter.",
    invalid_incident: "Le dossier indiqué n’est pas valide.",
    invalid_request: "La requête est incomplète ou invalide.",
    not_found: "Le dossier est introuvable.",
    forbidden: "Vous n’avez pas accès à ce dossier.",
    own_signature_required: "Votre propre signature doit être enregistrée pour le PDF et l’envoi.",
    verified_email_required: "Une adresse e-mail confirmée est requise pour l’envoi.",
    invalid_destination: "L’envoi est uniquement possible vers votre propre adresse e-mail confirmée.",
    rate_limit_failed: "La limite d’envoi n’a pas pu être vérifiée. Veuillez réessayer.",
    too_many_submissions: "Trop de tentatives d’envoi. Veuillez réessayer plus tard.",
    pdf_generation_failed: "Le PDF n’a pas pu être créé. Veuillez réessayer.",
    email_provider_not_configured: "L’envoi d’e-mails n’est pas encore configuré.",
    email_send_failed: "L’e-mail n’a pas pu être envoyé. Veuillez réessayer plus tard.",
    submission_failed: "Le constat n’a pas pu être envoyé. Veuillez réessayer.",
  },
  it: {
    method_not_allowed: "Questa richiesta non è supportata.",
    unauthorized: "Acceda nuovamente.",
    invalid_incident: "Il caso indicato non è valido.",
    invalid_request: "La richiesta è incompleta o non valida.",
    not_found: "Il caso non è stato trovato.",
    forbidden: "Non ha accesso a questo caso.",
    own_signature_required: "Per il PDF e l’invio deve essere salvata la sua firma.",
    verified_email_required: "Per l’invio è necessario un indirizzo e-mail confermato.",
    invalid_destination: "L’invio è possibile solo al proprio indirizzo e-mail confermato.",
    rate_limit_failed: "Non è stato possibile verificare il limite di invio. Riprovi.",
    too_many_submissions: "Troppi tentativi di invio. Riprovi più tardi.",
    pdf_generation_failed: "Non è stato possibile creare il PDF. Riprovi.",
    email_provider_not_configured: "L’invio e-mail non è ancora configurato.",
    email_send_failed: "Non è stato possibile inviare l’e-mail. Riprovi più tardi.",
    submission_failed: "Non è stato possibile inviare il verbale. Riprovi.",
  },
  en: {
    method_not_allowed: "This request is not supported.",
    unauthorized: "Please sign in again.",
    invalid_incident: "The specified case is invalid.",
    invalid_request: "The request is incomplete or invalid.",
    not_found: "The case could not be found.",
    forbidden: "You do not have access to this case.",
    own_signature_required: "Your own signature must be saved before creating or sending the PDF.",
    verified_email_required: "A verified email address is required for sending.",
    invalid_destination: "The report can only be sent to your own verified email address.",
    rate_limit_failed: "The sending limit could not be checked. Please try again.",
    too_many_submissions: "Too many sending attempts. Please try again later.",
    pdf_generation_failed: "The PDF could not be generated. Please try again.",
    email_provider_not_configured: "Email delivery is not configured yet.",
    email_send_failed: "The email could not be sent. Please try again later.",
    submission_failed: "The report could not be sent. Please try again.",
  },
};

export function normalizeLocale(value: unknown): AppLocale {
  const locale = typeof value === "string" ? value.toLowerCase() : "";
  if (locale.startsWith("de")) return "de";
  if (locale.startsWith("fr")) return "fr";
  if (locale.startsWith("it")) return "it";
  return "en";
}

export function errorBody(code: string, locale: AppLocale) {
  return { error: code, message: messages[locale][code] ?? messages[locale].submission_failed };
}
