import { describe, expect, it } from "vitest";

import { ABOUT_ANSWER, isAboutAnswer, isAboutDocChat } from "./about";

describe("isAboutDocChat", () => {
  it.each([
    "are you fraudstar",
    "Are you a fraudster?",
    "are u a scam",
    "What can you do?",
    "what does DocChat do",
    "Who are you?",
    "What are you",
    "What's your name?",
    "Tell me about yourself",
    "How does DocChat work?",
    "Are you a real person?",
    "Hello there!",
    "Thanks!",
    "thank you so much",
    "how are you today?",
    "DocChat, who are you?",
  ])("recognises %j", (question) => {
    expect(isAboutDocChat(question)).toBe(true);
  });

  it.each([
    "What can you do with my lease?",
    "Are you able to find the deposit amount?",
    "Who is the landlord?",
    "What is the deposit?",
    "Are pets allowed?",
    "Thanks, and how much notice do I give?",
    "Is the landlord a fraudster?",
    "How does the rent review work?",
  ])("leaves %j to the documents", (question) => {
    expect(isAboutDocChat(question)).toBe(false);
  });
});

describe("isAboutAnswer", () => {
  it("recognises the canned line, however the apostrophe is written", () => {
    expect(isAboutAnswer(ABOUT_ANSWER)).toBe(true);
    expect(isAboutAnswer(` ${ABOUT_ANSWER.replace("'", "’")}`)).toBe(true);
    expect(isAboutAnswer("Your documents don't say anything about that.")).toBe(false);
  });
});
