import { useEffect, useRef, useState } from "react";
import type { ApprovalPrompt } from "../../core/bridge";

interface Props {
  prompt: ApprovalPrompt;
  onAnswer(approved: boolean, feedback: string, args?: Record<string, string>): void;
}

const WHAT: Record<string, string> = {
  UpdateFile: "Modificar un archivo de este equipo",
  MovePath: "Mover o renombrar en este equipo",
  RenamePath: "Renombrar en este equipo",
  DeleteFile: "Eliminar un archivo de este equipo",
  DeleteDir: "Eliminar una carpeta de este equipo",
  UploadToProject: "Subir archivos a un proyecto",
  DownloadFromProject: "Descargar archivos a este equipo",
  ClickBrowserElement: "Hacer clic en el navegador",
  TypeInBrowser: "Escribir en el navegador",
  SendWhatsappMessage: "Enviar un mensaje de WhatsApp",
  EditProjectFile: "Modificar un archivo del proyecto",
  MoveProjectPath: "Mover en un proyecto",
  RenameProjectPath: "Renombrar en un proyecto",
  DeleteProjectPath: "Eliminar de un proyecto",
  RememberPreference: "Guardar una preferencia permanente",
  BuildSkill: "Crear o actualizar una habilidad de la organización",
  GenerateImages: "Generar imágenes",
  EditImage: "Editar una imagen",
};

/** How each pickable value reads; anything unknown shows as itself. An edit runs the same
 *  two models through OpenAI's edit endpoint, so it names them as edits. */
const OPTION: Record<string, { label: string; hint: string }> = {
  "gpt-image-2.5-flare": { label: "Flare", hint: "Rápido — buena calidad para el día a día" },
  "gpt-image-2.5-sunburst": { label: "Sunburst", hint: "Máximo detalle y estilo — más lento" },
};
const EDIT_OPTION: Record<string, { label: string; hint: string }> = {
  "gpt-image-2.5-flare": { label: "Flare Edit", hint: "Rápido — ideal para ajustes en varias rondas" },
  "gpt-image-2.5-sunburst": { label: "Sunburst Edit", hint: "Conserva mejor los detalles en cada edición — más lento" },
};
const IMAGE_TOOLS = new Set(["GenerateImages", "EditImage"]);
const IMAGES_PER_APPROVAL = 10;

const CHOICE_LABEL: Record<string, string> = { model: "MODELO" };

/** One question at a time: the agent is paused until it is answered. */
export function ApprovalDialog({ prompt, onAnswer }: Props) {
  const { call, preview, origin } = prompt;
  const choices = Object.entries(call.choices ?? {}).filter(([, values]) => values.length > 1);
  const initial = () =>
    Object.fromEntries(
      choices.map(([name, values]) => {
        const asked = call.args[name];
        return [name, typeof asked === "string" && values.includes(asked) ? asked : values[0]];
      }),
    );

  const [feedback, setFeedback] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>(initial);
  const allow = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setFeedback("");
    setPicked(initial());
    allow.current?.focus();
    // a new prompt starts from what its own call asked for
  }, [prompt.id]);

  const where = call.location === "desktop" ? "EN ESTE EQUIPO" : "EN EL SERVIDOR";
  const options = call.name === "EditImage" ? EDIT_OPTION : OPTION;

  return (
    <div className="approval" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <div className="approval__panel connection-card">
        <div className="card-heading"><span>APROBACIÓN REQUERIDA</span><span className="card-heading__accent">● {where}</span></div>
        {origin && <p className="approval__origin">TAREA EN SEGUNDO PLANO · <span className="selectable">{origin}</span></p>}
        <h2 id="approval-title">{WHAT[call.name] ?? call.name}</h2>
        <p className="approval__tool">{call.name}</p>
        {call.detail && <p className="approval__detail selectable">{call.detail}</p>}
        {preview
          ? <pre className="approval__preview selectable">{preview}</pre>
          : <pre className="approval__preview selectable">{JSON.stringify(call.args, null, 2)}</pre>}

        {choices.map(([name, values]) => (
          <fieldset key={name} className="approval__choice">
            <legend>{CHOICE_LABEL[name] ?? name.toUpperCase()}</legend>
            <div className="approval__options" role="radiogroup">
              {values.map((value) => (
                <label key={value} className={picked[name] === value ? "approval__option approval__option--on" : "approval__option"}>
                  <input
                    type="radio"
                    name={`choice-${name}`}
                    value={value}
                    checked={picked[name] === value}
                    onChange={() => setPicked((current) => ({ ...current, [name]: value }))}
                  />
                  <span className="approval__option-label">{options[value]?.label ?? value}</span>
                  {options[value] && <span className="approval__option-hint">{options[value].hint}</span>}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        {IMAGE_TOOLS.has(call.name) && (
          <p className="approval__covers">
            Esta aprobación cubre hasta {IMAGES_PER_APPROVAL} imágenes, generadas y editadas, en {origin ? "esta tarea" : "esta respuesta"}
            {" "}con el modelo que elijas: el agente puede refinar el resultado en varias rondas sin volver a preguntarte.
          </p>
        )}
        <label htmlFor="approval-feedback">SI LO RECHAZAS, ¿QUÉ DEBERÍA HACER EN SU LUGAR? (OPCIONAL)</label>
        <div className="url-field">
          <span aria-hidden="true">❯</span>
          <input id="approval-feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} spellCheck={false} />
        </div>
        <div className="approval__actions">
          <button type="button" className="ghost-button" onClick={() => onAnswer(false, feedback)}>RECHAZAR</button>
          <button type="button" ref={allow} className="connect-button" onClick={() => onAnswer(true, "", choices.length ? picked : undefined)}>
            PERMITIR <span aria-hidden="true">✓</span>
          </button>
        </div>
      </div>
    </div>
  );
}
