// src/App.tsx
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
  Divider,
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

// ===============================
// コーパス読み込み・解析
// ===============================

function parseCorpus(tsv: string): CorpusPair[] {
  const lines = tsv.split(/\r?\n/);
  const result: CorpusPair[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    // Haskell版: (_id1:eng:_id2:jpn:_)  => 0=id1, 1=eng, 2=id2, 3=jpn
    if (cols.length >= 4) {
      const eng = cols[1].trim();
      const jpn = cols[3].trim();
      if (eng && jpn) {
        result.push({ eng, jpn });
      }
    }
  }

  return result;
}

// ランダムに1件選択
function randomPair(pairs: CorpusPair[]): CorpusPair | null {
  if (pairs.length === 0) return null;
  const i = Math.floor(Math.random() * pairs.length);
  return pairs[i];
}

// ===============================
// 採点ロジック (Haskell -> TS)
// ===============================

// 句読点・大文字小文字を無視して完全一致を見る
function normalizeExact(text: string): string {
  const lower = text.toLowerCase();
  const filtered = lower
    .split("")
    .filter((c) => !isPunctuation(c))
    .join("");
  return filtered.trim();
}

// 簡易的な英字句読点判定
function isPunctuation(ch: string): boolean {
  // Haskell版では Data.Char.isPunctuation を利用
  // ここでは英語文でよく出るものだけを削除対象にする
  return /[.,!?;:()"']/u.test(ch);
}

// 単語トークン化（英字のみ + アポストロフィ）
function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => {
      const cleaned = w
        .toLowerCase()
        .split("")
        .filter((c) => /[a-zA-Z'’]/.test(c))
        .join("");
      return cleaned;
    })
    .filter((w) => w.length > 0);
}

// ジャッカード類似度 (Haskell版に合わせて 2 * |A∩B| / (|A| + |B|))
function jaccardSimilarity(xs: string[], ys: string[]): number {
  const setX = new Set(xs);
  const setY = new Set(ys);

  const inter = new Set<string>();
  for (const x of setX) {
    if (setY.has(x)) inter.add(x);
  }

  const num = inter.size * 2;
  const denom = setX.size + setY.size;
  if (denom === 0) return 0;
  return num / denom;
}

function evaluateAnswer(model: string, user: string): string {
  if (normalizeExact(model) === normalizeExact(user)) {
    return "◎ 完全一致です。";
  }

  const sim = jaccardSimilarity(tokenize(model), tokenize(user));

  if (sim >= 0.8) {
    return "○ かなり近い表現です。細部を見直してみてください。";
  } else if (sim >= 0.5) {
    return "△ 一部は合っていますが、表現がだいぶ異なります。";
  } else {
    return "× 意味や構造が大きく異なります。模範解答を参考にしてください。";
  }
}

// ===============================
// LanguageTool 文法チェック
// ===============================

async function checkGrammar(sentence: string): Promise<string[]> {
  const params = new URLSearchParams();
  params.append("text", sentence);
  params.append("language", "en-US");

  const res = await fetch("https://api.languagetool.org/v2/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    return [
      `LanguageTool HTTPエラー: ${res.status} ${res.statusText}`,
    ];
  }

  const json = (await res.json()) as LTResponse;
  return formatMatches(json.matches);
}

function formatMatches(matches: LTMatch[]): string[] {
  if (!matches || matches.length === 0) {
    return ["文法上の問題は特に見つかりませんでした。"];
  }

  const result: string[] = [];
  matches.forEach((m, idx) => {
    const header = `${idx + 1}. ${m.message}`;
    const sugg =
      m.replacements && m.replacements.length > 0
        ? `   → Suggestion: ${m.replacements[0].value}`
        : "";

    result.push(header);
    if (sugg) result.push(sugg);
  });
  return result;
}

// ===============================
// メインコンポーネント
// ===============================

export default function App() {
  const [corpus, setCorpus] = useState<CorpusPair[]>([]);
  const [current, setCurrent] = useState<CorpusPair | null>(null);
  const [loadingCorpus, setLoadingCorpus] = useState(true);
  const [corpusError, setCorpusError] = useState<string | null>(null);

  const [userAnswer, setUserAnswer] = useState("");
  const [checking, setChecking] = useState(false);

  const [resultText, setResultText] = useState<string | null>(null);
  const [grammarMessages, setGrammarMessages] = useState<string[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // コーパス読み込み
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/corpus.tsv");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        const text = await res.text();
        const parsed = parseCorpus(text);
        if (parsed.length === 0) {
          throw new Error("有効なコーパス行が見つかりませんでした。");
        }
        setCorpus(parsed);
        setCurrent(randomPair(parsed));
      } catch (e: any) {
        setCorpusError(
          `コーパス読み込みエラー: ${e?.message ?? String(e)}`
        );
      } finally {
        setLoadingCorpus(false);
      }
    };
    load();
  }, []);

  const handleCheck = async () => {
    if (!current) return;
    if (!userAnswer.trim()) {
      setGeneralError("英訳を入力してください。");
      return;
    }
    setGeneralError(null);
    setChecking(true);

    try {
      // 採点
      const evalText = evaluateAnswer(current.eng, userAnswer);
      setResultText(evalText);

      // 文法チェック
      const msgs = await checkGrammar(userAnswer);
      setGrammarMessages(msgs);
    } catch (e: any) {
      setGeneralError(
        `文法チェック中にエラーが発生しました: ${e?.message ?? String(e)}`
      );
    } finally {
      setChecking(false);
    }
  };

  const handleNext = () => {
    if (!corpus.length) return;
    setCurrent(randomPair(corpus));
    setUserAnswer("");
    setResultText(null);
    setGrammarMessages([]);
    setGeneralError(null);
  };

  // ===========================
  // UI
  // ===========================
  if (loadingCorpus) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (corpusError || !current) {
    return (
      <Box sx={{ minHeight: "100vh", p: 4 }}>
        <Alert severity="error">{corpusError ?? "問題が取得できません。"}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <CssBaseline />
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <TranslateIcon sx={{ mr: 1 }} />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Endless Translating App
          </Typography>
          {/* ここに Stripe 支援ボタン等を後で追加 */}
          {/* <Button color="inherit">Support</Button> */}
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 4 }}>
        <Paper elevation={2} sx={{ p: 3, borderRadius: 3 }}>
          <Stack spacing={3}>
            <Typography variant="h5" component="h1">
             Endless Tranlating 
            </Typography>
            <Typography variant="body2" color="text.secondary">
              日本語の文がランダムに表示されます。英訳を入力して採点と文法チェックを行います。
            </Typography>

            {generalError && (
              <Alert severity="warning">{generalError}</Alert>
            )}

            {/* 日本語の問題 */}
            <Box
              sx={{
                p: 2,
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "background.paper",
              }}
            >
              <Typography variant="subtitle2" gutterBottom>
                Japanese
              </Typography>
              <Typography variant="body1">{current.jpn}</Typography>
            </Box>

            {/* 英訳入力 */}
            <TextField
              label="Your English"
              multiline
              minRows={2}
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              fullWidth
            />

            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                onClick={handleCheck}
                disabled={checking}
              >
                {checking ? "Checking..." : "採点・文法チェック"}
              </Button>
              <Button
                variant="outlined"
                onClick={handleNext}
                disabled={checking}
              >
                次の問題
              </Button>
            </Stack>

            {/* 結果表示 */}
            {resultText && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle1">Model answer</Typography>
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.default",
                  }}
                >
                  <Typography variant="body1">{current.eng}</Typography>
                </Box>

                <Typography variant="subtitle1" sx={{ mt: 2 }}>
                  Result
                </Typography>
                <Alert
                  severity={
                    resultText.startsWith("◎")
                      ? "success"
                      : resultText.startsWith("○")
                      ? "info"
                      : resultText.startsWith("△")
                      ? "warning"
                      : "error"
                  }
                >
                  {resultText}
                </Alert>

                <Typography variant="subtitle1" sx={{ mt: 2 }}>
                  Grammar check (LanguageTool)
                </Typography>
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.default",
                  }}
                >
                  {checking && <CircularProgress size={20} />}
                  {!checking &&
                    grammarMessages.map((msg, idx) => (
                      <Typography
                        variant="body2"
                        key={idx}
                        sx={{ whiteSpace: "pre-wrap" }}
                      >
                        {msg}
                      </Typography>
                    ))}
                </Box>
              </>
            )}
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}