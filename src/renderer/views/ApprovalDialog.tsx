import { useEffect, useRef, useState } from "react";
import type { ApprovalPrompt } from "../../core/bridge";

interface Props {
  prompt: ApprovalPrompt;
  onAnswer(approved: boolean, feedback: string): void;
}

const WHAT: Record<string, string> = {
  UpdateFile: "Modificar un archivo de este equipo",
  MovePath: "Mover o renombrar en este equipo",
  DeleteFile: "Eliminar un archivo de este equipo",
  DeleteDir: "Eliminar una carpeta de este equipo",
  UploadToProject: "Subir archivos a un proyecto",
  DownloadFromProject: "Descargar archivos a este equipo",
  ClickBrowserElement: "Hacer clic en el navegador",
  TypeInBrowser: "Escribir en el navegador",
  SendWhatsappMessage: "Enviar un mensaje de WhatsApp",
  EditProjectFile: "Modificar un archivo del proyecto",
  MoveProjectPath: "Mover en un proyecto",
  DeleteProjectPath: "Eliminar de un proyecto",
  RememberPreference: "Guardar una preferencia permanente",
  BuildSkill: "Crear o actualizar una habilidad de la organización",
};

/** One question at a time: the agent is paused until it is answered. */
export function ApprovalDialog({ prompt, onAnswer }: Props) {
  const [feedback, setFeedback] = useState("");
  const allow = useRef<HTMLButtonElement>(null);
  const { call, preview } = prompt;

  useEffect(() => {
    setFeedback("");
    allow.current?.focus();
  }, [prompt.id]);

  const where = call.location === "desktop" ? "EN ESTE EQUIPO" : "EN EL SERVIDOR";

  return (
    <div className="approval" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <div className="approval__panel connection-card">
        <div className="card-heading"><span>APROBACIÓN REQUERIDA</span><span className="card-heading__accent">● {where}</span></div>
        <h2 id="approval-title">{WHAT[call.name] ?? call.name}</h2>
        <p className="approval__tool">{call.name}</p>
        {call.detail && <p className="approval__detail selectable">{call.detail}</p>}
        {preview
          ? <pre className="approval__preview selectable">{preview}</pre>
          : <pre className="approval__preview selectable">{JSON.stringify(call.args, null, 2)}</pre>}
        <label htmlFor="approval-feedback">SI LO RECHAZAS, ¿QUÉ DEBERÍA HACER EN SU LUGAR? (OPCIONAL)</label>
        <div className="url-field">
          <span aria-hidden="true">❯</span>
          <input id="approval-feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} spellCheck={false} />
        </div>
        <div className="approval__actions">
          <button type="button" className="ghost-button" onClick={() => onAnswer(false, feedback)}>RECHAZAR</button>
          <button type="button" ref={allow} className="connect-button" onClick={() => onAnswer(true, "")}>
            PERMITIR <span aria-hidden="true">✓</span>
          </button>
        </div>
      </div>
    </div>
  );
}
