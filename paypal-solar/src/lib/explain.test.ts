import { describe, expect, it } from "vitest";
import { DEFAULT_TIP, factSentences, TIPS, type ExplanationFacts } from "./explain";

const facts: ExplanationFacts = {
  neighbour: "Haus 14",
  producer: "Haus 12",
  period: "June 2026",
  usedKWh: "271.1",
  sharedKWh: "131.31",
  coveragePct: "48",
  priceCt: "13.00",
  amountEur: "17.07",
  defaultSupplyCt: "38.78",
  regulatedCt: "19.77",
  savingEur: "5.39",
  smartMeterEur: "2.50",
};

describe("factSentences", () => {
  it("puts each figure next to its own unit and meaning", () => {
    const s = factSentences(facts);
    expect(s).toContain("131.31 kWh of it (48 %)");
    expect(s).toContain("this costs 17.07 €");
    expect(s).toContain("you saved 5.39 €");
    expect(s).toContain("13.00 ct/kWh");
  });
});

describe("TIPS", () => {
  it("contain no numbers in any script and no number words", () => {
    const numberWords =
      /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|half|quarter|dozen|percent)\b/i;
    for (const tip of Object.values(TIPS)) {
      expect(tip).not.toMatch(/\p{N}/u); // any Unicode number, incl. full-width digits
      expect(tip).not.toMatch(numberWords);
    }
  });

  it("the default tip is one of the tips", () => {
    expect(TIPS[DEFAULT_TIP]).toBeDefined();
  });
});
