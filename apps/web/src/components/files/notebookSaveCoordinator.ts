import type { EnvironmentId, NotebookCellEdit, NotebookDocument } from "@t3tools/contracts";
import { NotebookSaveError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { createRef, useEffect, useMemo } from "react";

import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

import { FileSaveCoordinator } from "./fileSaveCoordinator";
import {
  notebookEditorStoreKey,
  notebookEditorToCellEdits,
  useNotebookEditorStore,
} from "./notebookEditorStore";

const NOTEBOOK_SAVE_DEBOUNCE_MS = 500;
const isNotebookSaveError = Schema.is(NotebookSaveError);

export type NotebookSavePayload = {
  readonly baseRevision: string;
  readonly cells: ReadonlyArray<NotebookCellEdit>;
  readonly saveEpoch: number;
};

interface NotebookSaveOptions {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

function failureFromResult(result: {
  readonly _tag: string;
  readonly cause?: Cause.Cause<unknown>;
}) {
  if (result._tag !== "Failure" || result.cause === undefined) return null;
  return Cause.squash(result.cause);
}

export function useNotebookSaveCoordinator({
  environmentId,
  cwd,
  relativePath,
  onPendingChange,
}: NotebookSaveOptions): {
  readonly change: (payload: NotebookSavePayload) => void;
  readonly flush: () => void;
} {
  const saveNotebook = useAtomCommand(projectEnvironment.saveNotebook);
  const openNotebook = useAtomQueryRunner(projectEnvironment.openNotebook, {
    reportFailure: false,
    refresh: true,
  });
  const confirmSave = useNotebookEditorStore((state) => state.confirmSave);
  const setDiskChanged = useNotebookEditorStore((state) => state.setDiskChanged);
  const key = notebookEditorStoreKey(environmentId, cwd, relativePath);

  const session = useMemo(() => {
    const coordinatorRef = createRef<FileSaveCoordinator<NotebookSavePayload, NotebookDocument>>();
    return {
      change: (payload: NotebookSavePayload) => coordinatorRef.current?.change(payload),
      flush: () => coordinatorRef.current?.flush(),
      setup: () => {
        const coordinator = new FileSaveCoordinator<NotebookSavePayload, NotebookDocument>({
          debounceMs: NOTEBOOK_SAVE_DEBOUNCE_MS,
          onPendingChange: (pending) => onPendingChange(relativePath, pending),
          persist: async (payload) => {
            const result = await saveNotebook({
              environmentId,
              input: {
                cwd,
                relativePath,
                baseRevision: payload.baseRevision,
                cells: [...payload.cells],
              },
            });
            const failure = failureFromResult(result);
            if (isNotebookSaveError(failure) && failure.failure === "revision_conflict") {
              // Stop autosave until the user resolves the banner; still return the
              // failure so the coordinator does not clear pending.
              const opened = await openNotebook({
                environmentId,
                input: { cwd, relativePath },
              });
              if (opened._tag === "Success") {
                setDiskChanged(key, opened.value);
              } else if (failure.currentRevision !== undefined) {
                const current = useNotebookEditorStore.getState().get(key);
                if (current !== undefined) {
                  setDiskChanged(key, {
                    ...current.baseDocument,
                    revision: failure.currentRevision,
                  });
                }
              }
            }
            return result;
          },
          onConfirmed: (_payload, document) => {
            confirmSave(key, document, _payload.saveEpoch);
          },
        });
        coordinatorRef.current = coordinator;
        return () => {
          coordinatorRef.current = null;
          coordinator.dispose();
        };
      },
    };
  }, [
    confirmSave,
    cwd,
    environmentId,
    key,
    onPendingChange,
    openNotebook,
    relativePath,
    saveNotebook,
    setDiskChanged,
  ]);

  useEffect(session.setup, [session]);
  return session;
}

export function notebookSavePayloadFromStore(key: string): NotebookSavePayload | null {
  const state = useNotebookEditorStore.getState().get(key);
  if (state === undefined || !state.dirty) return null;
  return {
    baseRevision: state.baseDocument.revision,
    cells: notebookEditorToCellEdits(state),
    saveEpoch: state.saveEpoch,
  };
}
