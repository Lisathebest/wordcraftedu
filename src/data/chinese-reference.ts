export const sentenceStructures = [
  { id: "have", pattern: "I have a/an ___.", note: "我有……" },
  { id: "like", pattern: "I like ___.", note: "我喜欢……" },
  { id: "this-is", pattern: "This is my ___.", note: "这是我的……" },
  { id: "is", pattern: "The ___ is ___.", note: "这个……是……的" },
  { id: "can-see", pattern: "I can see a/an ___.", note: "我能看见……" },
  { id: "use-to", pattern: "I use the ___ to ___.", note: "我用……来……" },
  { id: "there-is", pattern: "There is a/an ___ in/on/under ___.", note: "某处有一个……" },
  { id: "present", pattern: "I ___ the ___ every day.", note: "我每天……" },
  { id: "past", pattern: "I ___ the ___ yesterday.", note: "我昨天……" },
  { id: "progressive", pattern: "I am ___ing with the ___ now.", note: "我现在正在……" },
] as const;

export const tenseHelp = [
  { title: "一般现在时", cue: "每天、经常", example: "I read every day." },
  { title: "一般过去时", cue: "昨天、上周", example: "I played yesterday." },
  { title: "现在进行时", cue: "现在、正在", example: "I am reading now." },
] as const;

export const joiningWords = [
  { word: "and", chinese: "和、并且" },
  { word: "but", chinese: "但是" },
  { word: "because", chinese: "因为" },
  { word: "then", chinese: "然后" },
  { word: "so", chinese: "所以" },
] as const;
