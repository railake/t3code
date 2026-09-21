import { describe, expect, it } from "vite-plus/test";

import { parseColabParams, parseColabTitle, setColabParamValue } from "./colabParams.ts";

describe("parseColabParams", () => {
  it("parses every supported param kind and the title line", () => {
    const source = [
      '#@title Heading { run: "auto", display-mode: "form" }',
      'x = 5 #@param {type:"integer"}',
      'name = "Ada" #@param {type:"string"}',
      'flag = True #@param {type:"boolean"}',
      'choice = "a" #@param ["a","b"]',
      'volume = 3 #@param {type:"slider", min:0, max:10, step:1}',
      'day = "2024-01-02" #@param {type:"date"}',
      'raw = expr #@param {type:"raw"}',
    ].join("\n");

    expect(parseColabTitle(source)).toEqual({
      text: "Heading",
      runAuto: true,
      displayMode: "form",
      line: 0,
    });
    expect(parseColabParams(source)).toEqual([
      { name: "x", kind: "number", value: "5", line: 1 },
      { name: "name", kind: "string", value: "Ada", line: 2 },
      { name: "flag", kind: "boolean", value: "True", line: 3 },
      { name: "choice", kind: "dropdown", value: "a", options: ["a", "b"], line: 4 },
      {
        name: "volume",
        kind: "slider",
        value: "3",
        min: 0,
        max: 10,
        step: 1,
        line: 5,
      },
      { name: "day", kind: "date", value: "2024-01-02", line: 6 },
      { name: "raw", kind: "raw", value: "expr", line: 7 },
    ]);
  });

  it("rewrites a param assignment while preserving the annotation", () => {
    const source = 'x = 5 #@param {type:"integer"}\ny = 1';
    expect(setColabParamValue(source, "x", "9")).toBe('x = 9 #@param {type:"integer"}\ny = 1');
    expect(setColabParamValue('name = "Ada" #@param {type:"string"}', "name", "Bob")).toBe(
      'name = "Bob" #@param {type:"string"}',
    );
    expect(setColabParamValue('flag = True #@param {type:"boolean"}', "flag", "False")).toBe(
      'flag = False #@param {type:"boolean"}',
    );
  });
});
