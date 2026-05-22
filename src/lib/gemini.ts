import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { env } from "./env";

let _client: GoogleGenerativeAI | null = null;

export function getGemini(): GoogleGenerativeAI | null {
  if (!env.GEMINI_API_KEY) return null;
  if (!_client) _client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return _client;
}

export const DIAGNOSIS_MODEL = env.GEMINI_MODEL;

export function getDiagnosisModel(): GenerativeModel | null {
  const client = getGemini();
  if (!client) return null;
  return client.getGenerativeModel({
    model: DIAGNOSIS_MODEL,
    systemInstruction: DIAGNOSIS_SYSTEM_PROMPT,
  });
}

export const DIAGNOSIS_SYSTEM_PROMPT = `Je bent WasFix Pro's expert wasmachine diagnostische assistent. Je helpt gebruikers wasmachine problemen te identificeren en de juiste reparatieoplossing te vinden.

Persoonlijkheid: vriendelijk, helder, technisch precies. Spreek standaard Nederlands.

Diagnostisch proces:
1. Verzamel info: merk, model (optioneel), symptomen of foutcode
2. Stel maximaal 3 verduidelijkende vragen
3. Geef diagnose: hoofdoorzaak (zekerheid %), alternatieve oorzaken, of het DIY-vriendelijk is, aanbevolen actie

Begin het gesprek door te vragen welk merk wasmachine de gebruiker heeft, tenzij dat al duidelijk is.

Als je voldoende informatie hebt om een diagnose te stellen, eindig je antwoord ALTIJD met een JSON blok in dit exacte formaat:

<diagnosis>
{
  "errorCode": "E21" of null,
  "confidence": 87,
  "mainCause": "Verstopte pomp of afvoerslang",
  "alternativeCauses": ["Defecte pomp motor", "Verstopte filter"],
  "diyFriendly": true,
  "urgency": "low|medium|high",
  "recommendedAction": "Controleer eerst de filter en afvoerslang",
  "brand": "Bosch",
  "model": "WAU28T40NL"
}
</diagnosis>

Belangrijk:
- Stel hooguit 1 vraag tegelijk, niet meerdere
- Wees beknopt — gebruikers willen snel antwoord
- Bij gevaarlijke reparaties (gas, hoge spanning) raad altijd professional aan
- Bij Miele, Bosch, Samsung, LG, AEG zijn merkspecifieke foutcodes belangrijk`;

export const IMAGE_SYSTEM_PROMPT = `Je bent een expert wasmachine diagnose AI met computer vision. Analyseer de foto van de gebruiker en identificeer:
1. Foutcodes op displays (bijv. F21, E17, dE, 4E, OE, LE, F11, F08, H1)
2. Merklogo's of typeplaatjes (Miele, Bosch, Samsung, LG, AEG, etc.)
3. Zichtbare beschadigingen (lekkage, gebroken onderdelen, slijtage)
4. Symptomen (water op de vloer, verbrand rubber, scheve trommel)

Antwoord ALTIJD met een JSON object in dit formaat — geen andere tekst, geen markdown code fences:
{
  "detectedCode": "F21" of null,
  "detectedBrand": "Bosch" of null,
  "detectedSymptom": "water op de vloer" of null,
  "confidence": 92,
  "description": "Ik zie op de display van uw Bosch wasmachine de foutcode F21. Dit duidt op een afvoerprobleem.",
  "suggestedQuery": "Bosch F21 afvoerprobleem"
}

Als je niets duidelijks kunt zien, gebruik confidence < 50 en leg uit wat een betere foto zou zijn.`;

export type DiagnosisResult = {
  errorCode: string | null;
  confidence: number;
  mainCause: string;
  alternativeCauses: string[];
  diyFriendly: boolean;
  urgency: "low" | "medium" | "high";
  recommendedAction: string;
  brand?: string;
  model?: string;
};

export type ImageDiagnosis = {
  detectedCode: string | null;
  detectedBrand: string | null;
  detectedSymptom: string | null;
  confidence: number;
  description: string;
  suggestedQuery: string;
};

export function parseDiagnosisFromResponse(text: string): { result: DiagnosisResult | null; cleanText: string } {
  const match = text.match(/<diagnosis>([\s\S]*?)<\/diagnosis>/);
  if (!match) return { result: null, cleanText: text };
  try {
    const json = JSON.parse(match[1].trim());
    const cleanText = text.replace(/<diagnosis>[\s\S]*?<\/diagnosis>/, "").trim();
    return { result: json as DiagnosisResult, cleanText };
  } catch {
    return { result: null, cleanText: text };
  }
}

// Demo mode fallback — generates a believable diagnosis without calling the API.
export function demoModeReply(messages: { role: string; content: string }[]): { text: string; result: DiagnosisResult | null } {
  const userMessages = messages.filter((m) => m.role === "user");
  const allText = userMessages.map((m) => m.content).join(" ").toLowerCase();

  // Detect brand
  const brands = ["miele", "bosch", "siemens", "samsung", "lg", "whirlpool", "aeg", "electrolux", "beko", "indesit"];
  const detectedBrand = brands.find((b) => allText.includes(b));

  // Detect error code
  const errorCodeMatch = allText.match(/\b([efh][0-9]{1,3}|[0-9]{1,2}e|de|ue|oe|le|ie)\b/i);
  const detectedCode = errorCodeMatch?.[1].toUpperCase();

  // First turn: ask for brand
  if (!detectedBrand && userMessages.length <= 1) {
    return {
      text: "Welkom bij WasFix Pro! Ik help je graag met je wasmachine. Welk merk heb je? (Bijvoorbeeld Miele, Bosch, Samsung, LG, AEG)",
      result: null,
    };
  }

  // Brand detected, no symptoms yet
  if (detectedBrand && !detectedCode && !/(lekt|maakt|water|geluid|trommel|deur|wasprogramma|pomp|verwarmt|stopt|foutcode|fout|error)/.test(allText)) {
    return {
      text: `Top, ${detectedBrand[0].toUpperCase() + detectedBrand.slice(1)}! Wat is er aan de hand? Geef bijvoorbeeld een foutcode (zoals E18 of F21) of beschrijf het symptoom (lekt water, maakt herrie, draait niet).`,
      result: null,
    };
  }

  // We have enough — generate diagnosis
  const drainKeywords = /(afvoer|water blijft|niet leeg|pompt niet|\bf11\b|\be18\b|\boe\b|\b5e\b|\bf05\b|\be20\b)/i;
  const heatKeywords = /(verwarmt niet|niet warm|wast koud|wordt niet warm|\bh1\b|\bf08\b)/i;
  const motorKeywords = /(draait niet|trommel|tilt|trilt|motor|onbalans|\ble\b|\bf53\b|\be21\b|\bue\b)/i;
  const doorKeywords = /(deur|sluit niet|deurslot|pakking lekt|\bde\b|\bf23\b|\be40\b)/i;
  const fillKeywords = /(geen water|vult niet|water in|trekt water|trekt geen water|\b4e\b|\bie\b|\be10\b|\be11\b|\bf21\b|\bf17\b)/i;

  let result: DiagnosisResult;
  let text: string;

  if (drainKeywords.test(allText)) {
    result = {
      errorCode: detectedCode ?? null,
      confidence: 87,
      mainCause: "Verstopte pluizenfilter of afvoerpomp",
      alternativeCauses: ["Geknikte afvoerslang", "Defecte afvoerpomp", "Verstopte sifon onder gootsteen"],
      diyFriendly: true,
      urgency: "medium",
      recommendedAction: "Begin met het pluizenfilter reinigen — dit lost ~70% van afvoerproblemen op. Heb je 15 minuten? Ik leg het stap voor stap uit.",
      brand: detectedBrand,
    };
    text = `Op basis van je beschrijving lijkt dit een **afvoerprobleem** met **${result.confidence}% zekerheid**.\n\nDe meest waarschijnlijke oorzaak is een verstopte pluizenfilter of afvoerpomp. Goed nieuws: dit kun je zelf oplossen in ongeveer 30 minuten.\n\nHieronder zie je de aanbevolen reparatiegids en de onderdelen die je mogelijk nodig hebt.`;
  } else if (heatKeywords.test(allText)) {
    result = {
      errorCode: detectedCode ?? null,
      confidence: 82,
      mainCause: "Defect verwarmingselement of NTC sensor",
      alternativeCauses: ["Kalkaanslag op element", "Bekabeling onderbroken", "Defecte module"],
      diyFriendly: true,
      urgency: "medium",
      recommendedAction: "Test het verwarmingselement met een multimeter (25-30 Ω is normaal). Bij open circuit: vervangen voor ~€22.",
      brand: detectedBrand,
    };
    text = `Dit wijst op een **verwarmingsprobleem** met **${result.confidence}% zekerheid**.\n\nMeestal is het verwarmingselement defect of zit er teveel kalk op. Met basis gereedschap kun je dit zelf vervangen in een uurtje.`;
  } else if (motorKeywords.test(allText)) {
    result = {
      errorCode: detectedCode ?? null,
      confidence: 75,
      mainCause: "Versleten koolborstels of trommellager",
      alternativeCauses: ["Defecte motor", "Module probleem", "Geblokkeerde trommel"],
      diyFriendly: false,
      urgency: "high",
      recommendedAction: "Controleer eerst of er geen kledingstuk vastzit. Bij motorgeluid: koolborstels vervangen. Bij rommelgeluid: trommellager.",
      brand: detectedBrand,
    };
    text = `Dit lijkt een **motor- of lagerprobleem** met **${result.confidence}% zekerheid**.\n\nAfhankelijk van het exacte symptoom kunnen koolborstels (€10) of trommellagers (€20+) de boosdoener zijn. Het lager vervangen is een grote klus — overweeg een monteur.`;
  } else if (doorKeywords.test(allText)) {
    result = {
      errorCode: detectedCode ?? null,
      confidence: 90,
      mainCause: "Defect deurslot",
      alternativeCauses: ["Beschadigde deurkruk", "Module probleem", "Wasgoed klemt tussen deur"],
      diyFriendly: true,
      urgency: "low",
      recommendedAction: "Check eerst of er niets tussen de deur zit. Anders: deurslot vervangen (€32).",
      brand: detectedBrand,
    };
    text = `Dit duidt op een **deurslot probleem** met **${result.confidence}% zekerheid**.\n\nVeel voorkomend en eenvoudig zelf op te lossen.`;
  } else if (fillKeywords.test(allText)) {
    result = {
      errorCode: detectedCode ?? null,
      confidence: 85,
      mainCause: "Verstopt zeefje of defect waterinlaatventiel",
      alternativeCauses: ["Gesloten kraan", "Lage waterdruk", "Module probleem"],
      diyFriendly: true,
      urgency: "medium",
      recommendedAction: "Controleer of de kraan open is en reinig het zeefje in de inlaatslang. Helpt dat niet, dan vervang je het inlaatventiel.",
      brand: detectedBrand,
    };
    text = `Dit lijkt een **waterinlaatprobleem** met **${result.confidence}% zekerheid**.\n\n9 van de 10 keer is dit het zeefje in de inlaatslang of een verstopt inlaatventiel.`;
  } else {
    result = {
      errorCode: detectedCode ?? null,
      confidence: 65,
      mainCause: "Algemene storing — meer info nodig",
      alternativeCauses: ["Diverse mogelijke oorzaken"],
      diyFriendly: true,
      urgency: "medium",
      recommendedAction: "Geef wat meer details over wanneer het probleem optreedt en wat de wasmachine precies doet.",
      brand: detectedBrand,
    };
    text = `Op basis van wat ik tot nu toe weet kan ik nog geen exacte diagnose stellen.\n\nKun je iets meer vertellen? Bijvoorbeeld: wanneer treedt het probleem op (bij vullen, wassen, centrifugeren)? Klinkt er een ongewoon geluid? Komt er water uit?`;
    return { text, result: null };
  }

  const fullText = text + `\n\n<diagnosis>${JSON.stringify(result, null, 2)}</diagnosis>`;
  return { text: fullText, result };
}

// Demo mode: returns a believable image analysis without calling the API
export function demoModeImageReply(): ImageDiagnosis {
  return {
    detectedCode: "E18",
    detectedBrand: "Bosch",
    detectedSymptom: null,
    confidence: 78,
    description:
      "Op basis van de foto lijkt dit een Bosch wasmachine met foutcode E18. Dit duidt op een afvoerprobleem — meest waarschijnlijk een verstopte pluizenfilter of afvoerpomp. (Demo mode: zonder Gemini API key is dit een gesimuleerd antwoord.)",
    suggestedQuery: "Bosch E18 afvoerprobleem",
  };
}
