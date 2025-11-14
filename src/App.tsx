import { useEffect, useState } from "react";
import {
  AppBar,
  Box,
  Button,
  CircularProgress,
  Container,
  CssBaseline,
  Paper,
  Stack,
  TextField,
  Toolbar,
  Typography,
  Alert,
} from "@mui/material";
import TranslateIcon from "@mui/icons-material/Translate";

// ===============================
// 型定義
// ===============================

type CorpusPair = {
  eng: string;
  jpn: string;
};

type LTReplacement = {
  value: string;
};

type LTMatch = {
  message: string;
  replacements: LTReplacement[];
};

type LTResponse = {
  matches: LTMatch[];
};

type LastResult = {
  jpn: string;
  eng: string;
  userAnswer: string;
  evalText: string;
  grammarMessages: string[];
};

// ===============================
// コーパス読み込み
// ===============================

function parseCorpus(tsv: string): CorpusPair[] {
  const lines = tsv.split(/\r?\n/);
  const result: CorpusPair[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length >= 4) {
      const eng = cols[1].trim();
      const jpn = cols[3].trim();
      if (eng && jpn) result.push({ eng, jpn });
    }
  }
  return result;
}

function randomPair(pairs: CorpusPair[]): CorpusPair | null {
  if (pairs.length === 0) return null;
  const i = Math.floor(Math.random() * pairs.length);
  return pairs[i];
}

// ===============================
// 採点ロジック
// ===============================

function normalizeExact(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:()"']/g, "")
    .trim();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z'’]/g, ""))
    .filter(Boolean);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  if (A.size + B.size === 0) return 0;
  return (inter * 2) / (A.size + B.size);
}

function evaluateAnswer(model: string, user: string): string {
  if (normalizeExact(model) === normalizeExact(user))
    return "◎ 完全一致です。";

  const sim = jaccardSimilarity(tokenize(model), tokenize(user));

  if (sim >= 0.8) return "○ かなり近い表現です。";
  if (sim >= 0.5) return "△ 一部は合っていますが違いがあります。";
  return "× 表現が大きく異なります。";
}

// ===============================
// LanguageTool API
// ===============================

async function checkGrammar(sentence: string): Promise<string[]> {
  const params = new URLSearchParams();
  params.append("text", sentence);
  params.append("language", "en-US");

  const res = await fetch("https://api.languagetool.org/v2/check", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    return [`LanguageTool HTTPエラー: ${res.status}`];
  }

  const json = (await res.json()) as LTResponse;
  if (json.matches.length === 0)
    return ["文法上の問題は特に見つかりませんでした。"];

  return json.matches.map((m, i) => {
    const sug = m.replacements[0]?.value;
    return sug ? `${i + 1}. ${m.message} → ${sug}` : `${i + 1}. ${m.message}`;
  });
}

// ===============================
// メイン
// ===============================

export default function App() {
  const [corpus, setCorpus] = useState<CorpusPair[]>([]);
  const [current, setCurrent] = useState<CorpusPair | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);

  const [userAnswer, setUserAnswer] = useState("");
  const [checking, setChecking] = useState(false);

  // コーパス読み込み
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}corpus.tsv`);
        const txt = await res.text();
        const parsed = parseCorpus(txt);
        setCorpus(parsed);
        setCurrent(randomPair(parsed));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const nextQuestion = () => {
    if (!corpus.length) return;
    setCurrent(randomPair(corpus));
    setUserAnswer("");
  };

  const handleCheck = async () => {
    if (!current) return;
    if (!userAnswer.trim()) return;

    setChecking(true);

    const evalText = evaluateAnswer(current.eng, userAnswer);
    const grammarMessages = await checkGrammar(userAnswer);

    // === 直前の結果を上部に1つだけ保持 ===
    setLastResult({
      jpn: current.jpn,
      eng: current.eng,
      userAnswer,
      evalText,
      grammarMessages,
    });

    nextQuestion();
    setChecking(false);
  };

  if (loading || !current) {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <TranslateIcon sx={{ mr: 1 }} />
          <Typography variant="h6">Endless Translating App</Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 4 }}>
        <Stack spacing={4}>

          {/* =============================
              上部：前回の結果 or アプリ説明
          ============================== */}
          <Paper sx={{ p: 3, borderRadius: 3 }}>
            {!lastResult ? (
              <>
                <Typography variant="h5">無限英訳トレーニング</Typography>
                <Typography variant="body2" sx={{ mt: 2 }}>
                  日本語が出ますので英訳してください。  
                  採点後、この部分に結果が表示されます。  
                  常に「上：結果」「下：次の問題」の構成です。
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="h6">直前の結果</Typography>

                <Typography variant="subtitle2" sx={{ mt: 2 }}>
                  Japanese
                </Typography>
                <Typography>{lastResult.jpn}</Typography>

                <Typography variant="subtitle2" sx={{ mt: 2 }}>
                  Model Answer
                </Typography>
                <Typography>{lastResult.eng}</Typography>

                <Typography variant="subtitle2" sx={{ mt: 2 }}>
                  Your Answer
                </Typography>
                <Typography>{lastResult.userAnswer}</Typography>

                <Typography variant="subtitle2" sx={{ mt: 2 }}>
                  Result
                </Typography>
                <Alert severity={
                  lastResult.evalText.startsWith("◎")
                    ? "success"
                    : lastResult.evalText.startsWith("○")
                    ? "info"
                    : lastResult.evalText.startsWith("△")
                    ? "warning"
                    : "error"
                }>
                  {lastResult.evalText}
                </Alert>

                <Typography variant="subtitle2" sx={{ mt: 2 }}>
                  Grammar
                </Typography>
                {lastResult.grammarMessages.map((msg, i) => (
                  <Typography key={i} variant="body2">
                    {msg}
                  </Typography>
                ))}
              </>
            )}
          </Paper>

          {/* =============================
              下部：現在の問題
          ============================== */}
          <Paper sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="subtitle2">Japanese (Current)</Typography>
            <Typography variant="h6" sx={{ mt: 1 }}>
              {current.jpn}
            </Typography>

            <TextField
              label="Your English"
              multiline
              fullWidth
              minRows={2}
              sx={{ mt: 3 }}
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  handleCheck();
                }
              }}
            />

            <Button
              variant="contained"
              sx={{ mt: 2 }}
              onClick={handleCheck}
              disabled={checking}
            >
              {checking ? "Checking..." : "採点 → 次の問題へ"}
            </Button>
          </Paper>

        </Stack>
      </Container>
    </Box>
  );
}