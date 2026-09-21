export type ColabParamKind =
  | "string"
  | "number"
  | "boolean"
  | "dropdown"
  | "slider"
  | "date"
  | "raw";

export type ColabParam = {
  readonly name: string;
  readonly kind: ColabParamKind;
  readonly value: string;
  readonly options?: ReadonlyArray<string>;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly line: number;
};

export type ColabTitle = {
  readonly text: string;
  readonly runAuto: boolean;
  readonly displayMode: "form" | "both" | null;
  readonly line: number;
};

const PARAM_LINE = /^([A-Za-z_][\w]*)\s*=\s*(.*?)\s*#@param(?:\s+(\{.*\}|\[[^\]]*\]))?\s*$/;

const TITLE_LINE = /^#@title\s+(.*?)(?:\s+(\{.*\}))?\s*$/;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseOptionsLiteral(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  try {
    const parsed = JSON.parse(trimmed.replace(/'/g, '"')) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseObjectLiteral(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    // Colab uses Python-ish `{type:"integer"}` — normalize to JSON.
    const normalized = trimmed
      .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false");
    const parsed = JSON.parse(normalized) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function kindFromType(typeValue: unknown, hasOptions: boolean): ColabParamKind {
  if (hasOptions) return "dropdown";
  if (typeof typeValue !== "string") return "raw";
  switch (typeValue) {
    case "string":
      return "string";
    case "number":
    case "integer":
    case "raw":
      return typeValue === "raw" ? "raw" : "number";
    case "boolean":
      return "boolean";
    case "slider":
      return "slider";
    case "date":
      return "date";
    default:
      return "raw";
  }
}

function formatAssignmentValue(kind: ColabParamKind, value: string): string {
  if (kind === "string" || kind === "date") return JSON.stringify(value);
  if (kind === "boolean") return value === "True" || value === "true" ? "True" : "False";
  if (kind === "number" || kind === "slider") return value;
  if (kind === "dropdown") {
    if (/^-?\d+(\.\d+)?$/.test(value) || value === "True" || value === "False") return value;
    return JSON.stringify(value);
  }
  return value;
}

export function parseColabTitle(source: string): ColabTitle | null {
  const firstLine = source.split("\n", 1)[0] ?? "";
  const match = TITLE_LINE.exec(firstLine);
  if (match === null) return null;
  const meta = match[2] === undefined ? null : parseObjectLiteral(match[2]);
  const displayModeRaw = meta?.["display-mode"];
  const displayMode =
    displayModeRaw === "form" || displayModeRaw === "both" ? displayModeRaw : null;
  return {
    text: (match[1] ?? "").trim(),
    runAuto: meta?.run === "auto",
    displayMode,
    line: 0,
  };
}

export function parseColabParams(source: string): ReadonlyArray<ColabParam> {
  const lines = source.split("\n");
  const params: ColabParam[] = [];
  for (let line = 0; line < lines.length; line += 1) {
    const rawLine = lines[line] ?? "";
    const match = PARAM_LINE.exec(rawLine);
    if (match === null) continue;
    const name = match[1] ?? "";
    const assignment = (match[2] ?? "").trim();
    const annotation = (match[3] ?? "").trim();
    const options = annotation.startsWith("[") ? parseOptionsLiteral(annotation) : null;
    const meta = annotation.startsWith("{") ? parseObjectLiteral(annotation) : null;
    const kind = kindFromType(meta?.type, options !== null);
    const min = typeof meta?.min === "number" ? meta.min : undefined;
    const max = typeof meta?.max === "number" ? meta.max : undefined;
    const step = typeof meta?.step === "number" ? meta.step : undefined;
    params.push({
      name,
      kind,
      value:
        kind === "boolean"
          ? assignment === "True" || assignment === "true"
            ? "True"
            : "False"
          : stripQuotes(assignment),
      ...(options === null ? {} : { options }),
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
      ...(step === undefined ? {} : { step }),
      line,
    });
  }
  return params;
}

export function setColabParamValue(source: string, name: string, value: string): string {
  const lines = source.split("\n");
  const params = parseColabParams(source);
  const target = params.find((param) => param.name === name);
  if (target === undefined) return source;
  const rawLine = lines[target.line] ?? "";
  const match = PARAM_LINE.exec(rawLine);
  if (match === null) return source;
  const annotation = match[3] ?? "";
  const formatted = formatAssignmentValue(target.kind, value);
  lines[target.line] =
    annotation.length > 0
      ? `${name} = ${formatted} #@param ${annotation}`
      : `${name} = ${formatted} #@param`;
  return lines.join("\n");
}

export function cellViewIsForm(metadata: Record<string, unknown>): boolean {
  return metadata.cellView === "form";
}
