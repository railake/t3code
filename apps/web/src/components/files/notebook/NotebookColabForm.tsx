import {
  cellViewIsForm,
  parseColabParams,
  parseColabTitle,
  setColabParamValue,
  type ColabParam,
} from "@t3tools/shared/colabParams";
import { useMemo, useState, type ReactNode } from "react";

export function NotebookColabForm(props: {
  readonly source: string;
  readonly metadata: Record<string, unknown>;
  readonly readOnly: boolean;
  readonly onSourceChange: (source: string) => void;
  readonly children: ReactNode;
}) {
  const title = useMemo(() => parseColabTitle(props.source), [props.source]);
  const params = useMemo(() => parseColabParams(props.source), [props.source]);
  const formOnly = title?.displayMode === "form" || cellViewIsForm(props.metadata);
  const [showCode, setShowCode] = useState(!formOnly);

  if (params.length === 0 && title === null) {
    return <>{props.children}</>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 md:flex-row">
      <div className="min-w-[12rem] shrink-0 space-y-2 rounded-md border border-border/50 bg-muted/20 p-2">
        {title !== null ? (
          <p className="text-[13px] font-medium text-foreground">{title.text}</p>
        ) : null}
        {params.map((param) => (
          <ColabParamControl
            key={param.name}
            param={param}
            readOnly={props.readOnly}
            onChange={(value) =>
              props.onSourceChange(setColabParamValue(props.source, param.name, value))
            }
          />
        ))}
        {formOnly ? (
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline"
            onClick={() => setShowCode((value) => !value)}
          >
            {showCode ? "Hide code" : "Show code"}
          </button>
        ) : null}
      </div>
      {!formOnly || showCode ? <div className="min-w-0 flex-1">{props.children}</div> : null}
    </div>
  );
}

function ColabParamControl(props: {
  readonly param: ColabParam;
  readonly readOnly: boolean;
  readonly onChange: (value: string) => void;
}) {
  const disabled = props.readOnly;
  const label = (
    <label className="mb-0.5 block text-[11px] text-muted-foreground">{props.param.name}</label>
  );
  if (props.param.kind === "boolean") {
    return (
      <div>
        {label}
        <input
          type="checkbox"
          checked={props.param.value === "True"}
          disabled={disabled}
          onChange={(event) => props.onChange(event.target.checked ? "True" : "False")}
        />
      </div>
    );
  }
  if (props.param.kind === "dropdown" && props.param.options) {
    return (
      <div>
        {label}
        <select
          className="w-full rounded border border-border/70 bg-background px-1 py-0.5 text-[12px]"
          value={props.param.value}
          disabled={disabled}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {props.param.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (props.param.kind === "slider") {
    return (
      <div>
        {label}
        <input
          type="range"
          className="w-full"
          min={props.param.min ?? 0}
          max={props.param.max ?? 100}
          step={props.param.step ?? 1}
          value={Number(props.param.value) || 0}
          disabled={disabled}
          onChange={(event) => props.onChange(event.target.value)}
        />
        <span className="text-[11px] text-muted-foreground">{props.param.value}</span>
      </div>
    );
  }
  if (props.param.kind === "date") {
    return (
      <div>
        {label}
        <input
          type="date"
          className="w-full rounded border border-border/70 bg-background px-1 py-0.5 text-[12px]"
          value={props.param.value}
          disabled={disabled}
          onChange={(event) => props.onChange(event.target.value)}
        />
      </div>
    );
  }
  return (
    <div>
      {label}
      <input
        type={props.param.kind === "number" ? "number" : "text"}
        className="w-full rounded border border-border/70 bg-background px-1 py-0.5 text-[12px]"
        value={props.param.value}
        disabled={disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  );
}
