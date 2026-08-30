import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const source = join(process.cwd(), "data", "chart.txt");
const output = join(process.cwd(), "data", "vocabulary.json");
const text = await readFile(source, "utf16le");
const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
const [header, ...rows] = lines;
const fields = header.split("\t");
const records = rows.map((line) => {
  const values = line.split("\t");
  const record = Object.fromEntries(fields.map((field, index) => [field.replace(/^@/, ""), values[index] ?? ""]));
  return {
    id: record.word,
    number: Number(record.num),
    level: record.Level,
    word: record.word,
    chinese: record.chinese,
    collocations: [record.collocation1, record.collocation2, record.collocation3],
    image: `/vocab/${basename(record.pic || `${record.word}.png`)}`,
    pronunciation: `/${record.word}/`,
    fallbackStructure: record.word.replace(/(^|[- ])\w/g, (match) => match.toUpperCase()),
  };
});
await writeFile(output, `${JSON.stringify(records, null, 2)}\n`, "utf8");
console.log(`Normalized ${records.length} vocabulary records to ${output}`);
