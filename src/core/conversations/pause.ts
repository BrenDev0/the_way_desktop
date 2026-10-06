import type { TurnPause } from "../api";

/** What happened, for the banner and the system notification: a short title, then what
 *  to do about it. Nothing is lost in any of them -- the turn carries on where it stopped. */
export function pauseText(pause: TurnPause | null | undefined): { title: string; body: string } {
  switch (pause?.reason) {
    case "rate_limit":
      return {
        title: "El proveedor de IA limitó las solicitudes",
        body: "Se alcanzó el límite de solicitudes por minuto. Espera un momento y reanuda.",
      };
    case "quota":
      return {
        title: "La clave de IA se quedó sin saldo",
        body: "La cuenta del proveedor llegó a su cuota o límite de gasto. Recarga saldo o pide otra clave a un administrador, y reanuda.",
      };
    case "timeout":
      return {
        title: "El modelo tardó demasiado en responder",
        body: "La solicitud excedió el tiempo de espera. Reanuda para intentarlo de nuevo.",
      };
    case "provider_error":
      return {
        title: "El proveedor de IA no está disponible",
        body: "El servicio falló o está saturado. Reanuda en unos minutos.",
      };
    case "credentials":
      return {
        title: "El proveedor rechazó la clave de IA",
        body: "La clave es inválida, fue revocada o no tiene acceso a este modelo. Pide a un administrador que la revise, y reanuda.",
      };
    case "interrupted":
      return {
        title: "El servidor se reinició a mitad del turno",
        body: "Reanuda para continuar desde el último paso guardado.",
      };
    default:
      return { title: "El turno se pausó", body: "Reanuda para continuar donde se quedó." };
  }
}

/** When retrying is worth it, if the provider said: "" when it is already, or never said. */
export function retryHint(pause: TurnPause | null | undefined, now = Date.now()): string {
  const at = pause?.retryAfter ? Date.parse(pause.retryAfter) : NaN;
  if (!Number.isFinite(at) || at <= now) return "";
  const time = new Date(at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `El proveedor pidió esperar hasta las ${time}.`;
}
