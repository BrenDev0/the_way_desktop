import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/core/api";
import { BY_CODE, FriendlyError, GENERIC, friendly } from "../../src/core/userMessages";
import { failedTaskText } from "../../src/core/tasks/failure";
import { operatorMessage } from "../../src/core/workspace/messages";

const ENGLISH = /\b(the|server|could not|error|failed|not found|invalid|already|answered)\b/i;

describe("what the person reads when something fails", () => {
  it("says a failure by its code, in Spanish", () => {
    expect(friendly(new ApiError(404, "conversation_folder_not_found", "Folder not found"))).toBe("Esa carpeta ya no existe.");
    expect(friendly(new ApiError(401, "invalid_credentials", "Incorrect email or password"))).toBe("Correo o contraseña incorrectos.");
    expect(friendly(new ApiError(0, "unreachable", "The server could not be reached."))).toBe("No se pudo conectar con el servidor.");
  });

  it("never carries the server's own words, whatever the code or the message", () => {
    for (const status of [0, 400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503]) {
      const text = friendly(new ApiError(status, "a_code_nobody_wrote_down", "The server answered 404. Traceback: boom"));

      expect(text).not.toMatch(/answered|Traceback|boom|server answered/);
      expect(text).not.toMatch(ENGLISH);
    }
  });

  it("says the kind of failure when the code is not known", () => {
    expect(friendly(new ApiError(404, "error", "x"))).toMatch(/ya no existe/);
    expect(friendly(new ApiError(500, "error", "x"))).toMatch(/problema/);
    expect(friendly(new ApiError(429, "error", "x"))).toMatch(/Demasiadas/);
    expect(friendly(new ApiError(0, "error", "x"))).toBe("No se pudo conectar con el servidor.");
  });

  it("says nothing of a bug or a library's message, only that it did not work", () => {
    expect(friendly(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(GENERIC);
    expect(friendly("a string")).toBe(GENERIC);
    expect(friendly(new Error("ENOENT: no such file or directory, open 'C:\secret'"))).toBe(GENERIC);
  });

  it("keeps what was already written for the person", () => {
    expect(friendly(new FriendlyError("Elige primero una carpeta de trabajo."))).toBe("Elige primero una carpeta de trabajo.");
  });

  it("has no English in any of the messages it knows", () => {
    for (const [code, text] of Object.entries(BY_CODE)) expect({ code, text, english: ENGLISH.test(text) }).toMatchObject({ english: false });
  });

  it("is what the files panel says too, for a server failure", () => {
    expect(operatorMessage(new ApiError(500, "error", "Internal Server Error"))).toMatch(/problema/);
    expect(operatorMessage(new ApiError(404, "project_not_found", "Project not found"))).toBe("Ese proyecto ya no existe.");
  });
});

describe("a failed background task", () => {
  it("says what happened, not the error the worker wrote for the agent", () => {
    const worker = "TASK FAILED -- ValueError: could not convert string to float: 'abc'";

    expect(failedTaskText(worker)).toBe("AGENTIX no pudo completar esta tarea. Puedes pedirle que la intente de nuevo.");
    expect(failedTaskText(worker)).not.toMatch(/ValueError|float/);
    expect(failedTaskText(null)).toMatch(/AGENTIX no pudo/);
  });

  it("says when it was an approval nobody answered", () => {
    const expired = "TASK FAILED -- it stopped to ask the user's approval and nobody answered within 7 days";

    expect(failedTaskText(expired)).toMatch(/caducó/);
  });
});
