/**
 * Indentation YAML subset used by the root serverless.yml.
 * Supports maps, lists, quoted scalars, booleans, and CloudFormation tags
 * (`!Sub`, `!Ref`, `!GetAtt`) preserved as strings. No anchors or merge keys.
 */

export type YamlValue = null | boolean | number | string | YamlValue[] | { [key: string]: YamlValue };

type Line = { indent: number; text: string };

function stripLineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || line[i - 1] === " ")) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function parseScalar(raw: string): YamlValue {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "~" || trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  const tagged = trimmed.match(/^!(?:Sub|Ref|GetAtt|Join|If|Not|And|Or|Equals|Select|Split|Base64|Cidr|FindInMap|GetAZs|ImportValue|Transform)\s+(.+)$/);
  if (tagged?.[1] !== undefined) return parseScalar(tagged[1]);
  return trimmed;
}

function looksLikeKey(text: string): boolean {
  const colon = text.indexOf(":");
  if (colon <= 0) return false;
  const after = text.slice(colon + 1);
  return after === "" || after.startsWith(" ");
}

function parseBlock(lines: Line[], start: number, minIndent: number): [YamlValue, number] {
  if (start >= lines.length) return [null, start];
  const first = lines[start];
  if (!first || first.indent < minIndent) return [null, start];

  if (first.text.startsWith("- ")) {
    const list: YamlValue[] = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      if (!line || line.indent < first.indent) break;
      if (line.indent !== first.indent || !line.text.startsWith("- ")) break;
      const rest = line.text.slice(2);
      if (looksLikeKey(rest)) {
        const colon = rest.indexOf(":");
        const key = rest.slice(0, colon);
        const inline = rest.slice(colon + 1).trim();
        const synthetic: Line[] = [{ indent: line.indent + 2, text: inline ? `${key}: ${inline}` : `${key}:` }];
        let j = i + 1;
        while (j < lines.length && lines[j] && (lines[j] as Line).indent > line.indent) {
          synthetic.push(lines[j] as Line);
          j += 1;
        }
        const [value] = parseBlock(synthetic, 0, line.indent + 2);
        list.push(value);
        i = j;
        continue;
      }
      if (rest.length > 0) {
        list.push(parseScalar(rest));
        i += 1;
        continue;
      }
      const [value, next] = parseBlock(lines, i + 1, line.indent + 1);
      list.push(value);
      i = next;
    }
    return [list, i];
  }

  const map: { [key: string]: YamlValue } = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || line.indent < first.indent) break;
    if (line.indent !== first.indent) {
      throw new Error(`unexpected indent at: ${line.text}`);
    }
    if (line.text.startsWith("- ")) break;
    if (!looksLikeKey(line.text)) {
      throw new Error(`expected key: ${line.text}`);
    }
    const colon = line.text.indexOf(":");
    const key = line.text.slice(0, colon);
    const inline = line.text.slice(colon + 1).trim();
    const next = lines[i + 1];
    if (inline.length > 0) {
      map[key] = parseScalar(inline);
      i += 1;
      continue;
    }
    if (!next || next.indent <= line.indent) {
      map[key] = null;
      i += 1;
      continue;
    }
    const [value, end] = parseBlock(lines, i + 1, next.indent);
    map[key] = value;
    i = end;
  }
  return [map, i];
}

export function parseYaml(source: string): YamlValue {
  const lines: Line[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const text = stripLineComment(raw).replace(/\t/g, "  ");
    if (text.trim() === "") continue;
    const indent = text.match(/^ */)?.[0].length ?? 0;
    lines.push({ indent, text: text.trimStart() });
  }
  if (lines.length === 0) return {};
  const [value] = parseBlock(lines, 0, 0);
  return value ?? {};
}

export function asMap(value: YamlValue | undefined, label: string): { [key: string]: YamlValue } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value;
}

export function asList(value: YamlValue | undefined, label: string): YamlValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  return value;
}
