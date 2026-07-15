import { defaultSerializeAnswers } from "../tools/ask-user/serialize-answers";

describe("defaultSerializeAnswers", () => {
  const questions = [
    { prompt: "Should I proceed?" },
    { prompt: "Pick a color" },
    { prompt: "Any notes?" },
    { prompt: "Which options?" },
  ];

  it("renders a boolean true as 'yes'", () => {
    expect(defaultSerializeAnswers([questions[0]], [true])).toBe(
      "Should I proceed?: yes",
    );
  });

  it("renders a boolean false as 'no'", () => {
    expect(defaultSerializeAnswers([questions[0]], [false])).toBe(
      "Should I proceed?: no",
    );
  });

  it("renders a string answer verbatim", () => {
    expect(defaultSerializeAnswers([questions[1]], ["Blue"])).toBe(
      "Pick a color: Blue",
    );
  });

  it("renders null as '(no answer)'", () => {
    expect(defaultSerializeAnswers([questions[2]], [null])).toBe(
      "Any notes?: (no answer)",
    );
  });

  it("joins a string[] answer with ', '", () => {
    expect(defaultSerializeAnswers([questions[3]], [["Red", "Blue"]])).toBe(
      "Which options?: Red, Blue",
    );
  });

  it("renders one line per question, in order", () => {
    expect(
      defaultSerializeAnswers(questions, [true, "Blue", null, ["Red", "Blue"]]),
    ).toBe(
      [
        "Should I proceed?: yes",
        "Pick a color: Blue",
        "Any notes?: (no answer)",
        "Which options?: Red, Blue",
      ].join("\n"),
    );
  });
});
