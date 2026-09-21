import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, NotebookOpenError, type NotebookDocument } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { projectEnvironment } from "~/state/projects";

const EMPTY_NOTEBOOK_PATH = "";
const EMPTY_NOTEBOOK_QUERY_ATOM = Atom.make(
  AsyncResult.initial<NotebookDocument, never>(false),
).pipe(Atom.withLabel("notebook-query:empty"));
const isNotebookOpenError = Schema.is(NotebookOpenError);

function getNotebookQueryAtom(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string | null,
) {
  return projectEnvironment.openNotebook({
    environmentId,
    input: { cwd, relativePath: relativePath ?? EMPTY_NOTEBOOK_PATH },
  });
}

function failureCause<A>(result: AsyncResult.AsyncResult<A, unknown>): unknown {
  return result._tag === "Failure" ? Cause.squash(result.cause) : null;
}

function errorMessage(cause: unknown): string | null {
  if (cause === null) return null;
  return cause instanceof Error ? cause.message : "The notebook could not be opened.";
}

export function useNotebookQuery(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string | null,
  enabled = true,
): {
  readonly data: NotebookDocument | null;
  readonly error: string | null;
  readonly isNotFile: boolean;
  readonly isPending: boolean;
  readonly refresh: () => void;
} {
  const atom = enabled
    ? getNotebookQueryAtom(environmentId, cwd, relativePath)
    : EMPTY_NOTEBOOK_QUERY_ATOM;
  const result = useAtomValue(atom);
  const refreshAtom = useAtomRefresh(atom);
  const refresh = useCallback(() => refreshAtom(), [refreshAtom]);
  const cause = failureCause(result);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: errorMessage(cause),
    isNotFile: isNotebookOpenError(cause) && cause.failure === "path_not_file",
    isPending: result.waiting,
    refresh,
  };
}
