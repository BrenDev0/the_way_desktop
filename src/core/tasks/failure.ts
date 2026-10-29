/**
 * What a failed task says to the person. The server keeps for the agent what went wrong, in
 * English and with the error's own name; it is not for the screen, which says what happened
 * and what to do.
 */
export function failedTaskText(result: string | null): string {
  if (result?.includes("nobody answered")) {
    return "La tarea esperó tu aprobación hasta que caducó (7 días) y se detuvo. Pídele a AGENTIX que la repita.";
  }
  return "AGENTIX no pudo completar esta tarea. Puedes pedirle que la intente de nuevo.";
}
