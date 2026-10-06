import { useCallback, useEffect, useRef, useState } from "react";
import { Microphone } from "./microphone";
import { Speaker } from "./speaker";

interface Options {
  /** What was said, once it has been transcribed. Never called with empty text. */
  onTranscript(text: string): void;
}

/** How a recording was started, which decides what ends it. */
type Trigger = "keys" | "button";

/**
 * Voice for the chat: hold Ctrl+M (or click the mic) to talk, and hear the reply.
 *
 * Ctrl+M is matched on the physical key, so it is the same key on a Spanish, Latin
 * American or English layout, and no editing shortcut uses it -- unlike a bare Ctrl,
 * which went off on every copy and paste. Because the combination is unambiguous the
 * recording starts the instant it is pressed, with no hold delay to cut off the first word.
 */
export function useVoice({ onTranscript }: Options) {
  const [on, setOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mic = useRef<Microphone | null>(null);
  const opening = useRef<Promise<Microphone> | null>(null);
  const speaker = useRef<Speaker | null>(null);
  const trigger = useRef<Trigger | null>(null);
  const transcript = useRef(onTranscript);
  transcript.current = onTranscript;

  const silence = useCallback(() => {
    speaker.current?.stop();
    speaker.current = null;
  }, []);

  /** The open microphone, opening it first if voice was off. */
  const ensureMic = useCallback(async (): Promise<Microphone> => {
    if (mic.current) return mic.current;
    opening.current ??= Microphone.open().finally(() => { opening.current = null; });
    const opened = await opening.current;
    mic.current = opened;
    setOn(true);
    // the first spoken sentence would otherwise pay the connection setup to the speech
    // service; best effort -- a voice key problem shows up when it is actually used
    void window.desktop.voice.warm().catch(() => {});
    return opened;
  }, []);

  const turnOff = useCallback(() => {
    silence();
    mic.current?.close();
    mic.current = null;
    trigger.current = null;
    setRecording(false);
    setOn(false);
  }, [silence]);

  const start = useCallback(async (how: Trigger) => {
    if (trigger.current) return;
    trigger.current = how;
    // talking over the reply means you have heard enough of it
    silence();
    setError(null);
    try {
      const opened = await ensureMic();
      // released while the microphone was still opening
      if (trigger.current !== how) return;
      opened.start();
      setRecording(true);
    } catch (reason) {
      trigger.current = null;
      setError(micError(reason));
    }
  }, [ensureMic, silence]);

  const finish = useCallback(async (send: boolean) => {
    const current = mic.current;
    trigger.current = null;
    setRecording(false);
    if (!current?.recording) return;
    if (!send) {
      current.cancel();
      return;
    }

    const wav = current.stop();
    if (!wav) return;
    setTranscribing(true);
    try {
      const text = (await window.desktop.voice.transcribe(wav)).trim();
      if (text) transcript.current(text);
    } catch (reason) {
      setError(voiceError(reason));
    } finally {
      setTranscribing(false);
    }
  }, []);

  // Listening on the window in the capture phase, so the shortcut works wherever focus is
  // in the app, the composer included, and the textarea never sees the M.
  useEffect(() => {
    function down(event: KeyboardEvent) {
      if (event.code === "KeyM" && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        // holding a key repeats it; only the first press starts anything
        if (!event.repeat) void start("keys");
        return;
      }
      // any other key while talking means they are typing, not talking: drop the recording
      if (trigger.current === "keys" && event.key !== "Control") void finish(false);
    }
    function up(event: KeyboardEvent) {
      if (trigger.current === "keys" && (event.code === "KeyM" || event.key === "Control")) void finish(true);
    }
    // a release that happens in another window never arrives here
    function blur() {
      if (trigger.current === "keys") void finish(false);
    }
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, [start, finish]);

  useEffect(() => turnOff, [turnOff]);

  /** The voice switch: microphone ready and replies spoken, or neither. */
  const toggle = useCallback(async () => {
    if (mic.current || opening.current) {
      turnOff();
      return;
    }
    setError(null);
    try {
      await ensureMic();
    } catch (reason) {
      setError(micError(reason));
    }
  }, [ensureMic, turnOff]);

  /** The mic button: click to talk, click again to send. */
  const toggleRecording = useCallback(() => {
    if (trigger.current === "button") void finish(true);
    else if (!trigger.current) void start("button");
  }, [start, finish]);

  /** A turn is starting: its reply is spoken if voice is on. */
  const beginReply = useCallback(() => {
    silence();
    if (!mic.current) return;
    speaker.current = new Speaker(
      (text, chunk) => window.desktop.voice.speak(text, chunk),
      setSpeaking,
      (reason) => setError(voiceError(reason)),
    );
  }, [silence]);

  const replyText = useCallback((text: string) => speaker.current?.feed(text), []);

  const endReply = useCallback(() => {
    speaker.current?.finish();
    speaker.current = null;
  }, []);

  return {
    on,
    recording,
    transcribing,
    speaking,
    error,
    toggle,
    toggleRecording,
    beginReply,
    replyText,
    endReply,
    silence: () => { silence(); setSpeaking(false); },
  };
}

function micError(reason: unknown): string {
  const name = reason instanceof DOMException ? reason.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "No se pudo usar el micrófono. Revisa los permisos de micrófono de Windows.";
  }
  if (name === "NotFoundError") return "No se encontró ningún micrófono.";
  return "No se pudo abrir el micrófono.";
}

function voiceError(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason);
  if (text.includes("needs an OpenAI key")) return "La voz necesita una clave de OpenAI. Pide a un administrador que te la asigne.";
  if (text.includes("OpenAI key was rejected")) return "Tu clave de OpenAI fue rechazada. Pide a un administrador una nueva.";
  if (text.includes("too long")) return "La grabación es demasiado larga.";
  if (text.includes("could not be reached")) return "Sin conexión con el servidor.";
  return "La voz no está disponible en este momento.";
}
