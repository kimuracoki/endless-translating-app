import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
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
import gsap from "gsap";

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

type FrameState = {
  lastResult: LastResult | null;
  current: CorpusPair;
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
  if (normalizeExact(model) === normalizeExact(user)) return "◎ 完全一致です。";

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
// 一枚の「フレーム」（上:結果 / 下:問題）
// ===============================

type FrameProps = {
  frame: FrameState;
  userAnswer?: string;
  checking?: boolean;
  interactive?: boolean;
  onChangeAnswer?: (v: string) => void;
  onSubmit?: () => void;
  // 型を useRef と合わせる
  inputRef?: MutableRefObject<HTMLInputElement | null>;
};

function Frame({
  frame,
  userAnswer = "",
  checking = false,
  interactive = false,
  onChangeAnswer,
  onSubmit,
  inputRef,
}: FrameProps) {
  const { lastResult, current } = frame;

  return (
    <Stack spacing={4}>
      {/* 上部：直前の結果 or 説明 */}
      <Paper sx={{ p: 3, borderRadius: 3 }}>
        {!lastResult ? (
          <>
            <Typography variant="h5">無限英訳トレーニング</Typography>
            <Typography variant="body2" sx={{ mt: 2 }}>
              日本語をとにかく英訳してください。
              <br />
              問題は尽きることがないので、尽きるとしたら、あなたの体力の方でしょう。
              <br />
            </Typography>
            <Typography variant="body2" sx={{ mt: 2 }}>
              回答後、模範解答と簡易的な文法チェック結果を表示します。
              <br />
              模範解答だけが正解ではありません。
              <br />
              参考程度にして、さっさと次に進みましょう。
            </Typography>
          </>
        ) : (
          <>
            <Typography variant="h6">採点結果</Typography>

            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              原文
            </Typography>
            <Typography>{lastResult.jpn}</Typography>

            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              模範解答
            </Typography>
            <Typography>{lastResult.eng}</Typography>

            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              あなたの解答
            </Typography>
            <Typography>{lastResult.userAnswer}</Typography>

            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              一致度合い
            </Typography>
            <Alert
              sx={{ mt: 0.5 }}
              severity={
                lastResult.evalText.startsWith("◎")
                  ? "success"
                  : lastResult.evalText.startsWith("○")
                  ? "info"
                  : lastResult.evalText.startsWith("△")
                  ? "warning"
                  : "error"
              }
            >
              {lastResult.evalText}
            </Alert>

            <Typography variant="subtitle2" sx={{ mt: 2 }}>
              簡易文法チェック
            </Typography>
            {lastResult.grammarMessages.map((msg, i) => (
              <Typography key={i} variant="body2">
                {msg}
              </Typography>
            ))}
          </>
        )}
      </Paper>

      {/* 下部：現在の問題 */}
      <Paper sx={{ p: 3, borderRadius: 3 }}>
        <Typography variant="subtitle2">次の問題</Typography>
        <Typography variant="h6" sx={{ mt: 1 }}>
          {current.jpn}
        </Typography>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ mt: 2, display: "block" }}
        >
          Enter で改行、Ctrl+Enter / Cmd+Enter で「採点 → 次の問題へ」です。
        </Typography>

        <TextField
          label="Your English"
          multiline
          fullWidth
          minRows={2}
          sx={{ mt: 1 }}
          value={userAnswer}
          inputRef={inputRef} // フォーカス用
          onChange={
            interactive
              ? (e) => onChangeAnswer && onChangeAnswer(e.target.value)
              : undefined
          }
          onKeyDown={
            interactive
              ? (e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    if (!checking) onSubmit && onSubmit();
                  }
                }
              : undefined
          }
          InputProps={{
            readOnly: !interactive,
          }}
        />

        <Button
          variant="contained"
          sx={{ mt: 2 }}
          onClick={interactive ? onSubmit : undefined}
          disabled={checking || !interactive}
        >
          {checking ? "Checking..." : "採点 → 次の問題へ"}
        </Button>
      </Paper>
    </Stack>
  );
}

// ===============================
// メイン
// ===============================

export default function App() {
  const [corpus, setCorpus] = useState<CorpusPair[]>([]);
  const [frame, setFrame] = useState<FrameState | null>(null); // 現在表示中の 1 フレーム
  const [loading, setLoading] = useState(true);

  const [userAnswer, setUserAnswer] = useState("");
  const [checking, setChecking] = useState(false);

  // アニメーション用
  const [animating, setAnimating] = useState(false);
  const [animFrom, setAnimFrom] = useState<FrameState | null>(null);
  const [animTo, setAnimTo] = useState<FrameState | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const firstFrameRef = useRef<HTMLDivElement | null>(null);

  // 入力欄へのフォーカス用 ref
  const inputRef = useRef<HTMLInputElement | null>(null);

  // コーパス読み込み
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}corpus.tsv`);
        const txt = await res.text();
        const parsed = parseCorpus(txt);
        setCorpus(parsed);
        const initialQ = randomPair(parsed);
        if (initialQ) {
          setFrame({ lastResult: null, current: initialQ });
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // フレーム表示中かつ非アニメ中は常に入力欄にフォーカス
  useEffect(() => {
    if (!animating && frame && inputRef.current) {
      inputRef.current.focus();
    }
  }, [frame, animating]);

  const pickNextQuestion = () => {
    if (!corpus.length) return null;
    return randomPair(corpus);
  };

  const handleCheck = async () => {
    if (!frame) return;
    if (!userAnswer.trim()) return;

    const current = frame.current;
    setChecking(true);

    const evalText = evaluateAnswer(current.eng, userAnswer);
    const grammarMessages = await checkGrammar(userAnswer);

    const newResult: LastResult = {
      jpn: current.jpn,
      eng: current.eng,
      userAnswer,
      evalText,
      grammarMessages,
    };
    const newQuestion = pickNextQuestion();
    if (!newQuestion) {
      setChecking(false);
      return;
    }

    // アニメーション用の from/to フレームを用意
    const fromFrame: FrameState = {
      lastResult: frame.lastResult,
      current: frame.current,
    };
    const toFrame: FrameState = {
      lastResult: newResult,
      current: newQuestion,
    };

    setAnimFrom(fromFrame);
    setAnimTo(toFrame);
    setAnimating(true);
  };

  // 紙芝居スクロールアニメーション
  useLayoutEffect(() => {
    if (!animating) return;
    if (!viewportRef.current || !stripRef.current || !firstFrameRef.current)
      return;
    if (!animFrom || !animTo) return;

    const viewport = viewportRef.current;
    const strip = stripRef.current;
    const firstFrameEl = firstFrameRef.current;

    const h = firstFrameEl.offsetHeight;
    if (!h) {
      // 高さが取れないときはフォールバックして即切り替え
      setFrame(animTo);
      setAnimating(false);
      setAnimFrom(null);
      setAnimTo(null);
      setUserAnswer("");
      setChecking(false);
      return;
    }

    // ビューポートを 1 フレーム分の高さに固定
    viewport.style.height = `${h}px`;
    gsap.set(strip, { y: 0 });

    const tl = gsap.timeline({
      defaults: { duration: 0.45, ease: "power2.inOut" },
      onComplete: () => {
        // 最終的なフレーム状態に確定
        setFrame(animTo);
        setAnimating(false);
        setAnimFrom(null);
        setAnimTo(null);
        setUserAnswer("");
        setChecking(false);

        viewport.style.height = "";
        gsap.set(strip, { clearProps: "transform" });
      },
    });

    // 1フレーム分きっちり上へスクロール
    tl.to(strip, { y: -h });

    return () => {
      tl.kill();
    };
  }, [animating, animFrom, animTo]);

  if (loading || !frame) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <CssBaseline />
      <AppBar position="sticky">
        <Toolbar>
          <TranslateIcon sx={{ mr: 1 }} />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Endless Translating
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ py: 4 }}>
        {/* 通常時：1フレームだけ（上：結果 / 下：問題） */}
        {!animating && (
          <Frame
            frame={frame}
            userAnswer={userAnswer}
            checking={checking}
            interactive={true}
            onChangeAnswer={setUserAnswer}
            onSubmit={handleCheck}
            inputRef={inputRef} // ここで ref を渡す
          />
        )}

        {/* アニメーション中：旧フレーム＋新フレームを縦に並べて strip をスクロール */}
        {animating && animFrom && animTo && (
          <Box ref={viewportRef} sx={{ overflow: "hidden" }}>
            <Box ref={stripRef}>
              <Box ref={firstFrameRef}>
                <Frame frame={animFrom} interactive={false} />
              </Box>
              <Box>
                <Frame frame={animTo} interactive={false} />
              </Box>
            </Box>
          </Box>
        )}
      </Container>
    </Box>
  );
}