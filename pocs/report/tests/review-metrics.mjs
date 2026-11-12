import { computeSpeechMetrics, findFillers } from "../lib/metrics.ts";
const S = (t, text, phase = "presentation") => ({ id: String(t), t, text, phase });
const show = (name, m) => console.log(name, JSON.stringify({ n: m.sentenceCount, spm: m.syllablesPerMinute, sec: m.spokenSeconds, tu: m.timeUsage, ts: m.timeStatus, f: m.fillers.total, fpm: m.fillers.perMinute, p: m.pauses.count, d: m.deliveryScore, pen: m.deliveryPenalties }));
show("single", computeSpeechMetrics([S(0, "안녕하세요 저희는 리웨이브입니다.")], { presentationMinutes: 5 }));
show("same-t", computeSpeechMetrics([S(5, "가나다라마바사"), S(5, "가나다라마바사"), S(5, "가나다라마바사"), S(5, "가나다라마")], { presentationMinutes: 1 }));
show("unsorted", computeSpeechMetrics([S(20, "세 번째 문장입니다 여기요."), S(0, "첫 번째 문장입니다 여기요."), S(10, "두 번째 문장입니다 여기요.")], { presentationMinutes: 1 }));
show("one-long-silence", computeSpeechMetrics([S(0, "첫 문장을 말합니다."), S(5, "두 번째 문장을 말합니다."), S(10,"세 번째 문장입니다."), S(200, "아주 오래 쉬고 마지막 문장.")], { presentationMinutes: 4 }));
show("qa-only", computeSpeechMetrics([S(0, "음 답변입니다", "qa")], { presentationMinutes: 5 }));
for (const t of ["그 회사는 좋습니다", "그, 그러니까 저희는", "저 저희는", "음... 어 그게", "이제 시작하겠습니다", "사실 원가는 142원입니다", "좀 더 말씀드리면"]) console.log(t, JSON.stringify(findFillers(t)));
