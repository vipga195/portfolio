import { humanizeDuration } from "../lib/training/lab-model.ts";
import type { ErrorKind, RunStatus } from "../lib/training/lab-model";
import type { AlgorithmId } from "../lib/training/ui-schema";
import type { Localized } from "./config";

export type ContactFormLabels = {
  name: string;
  email: string;
  company: string;
  message: string;
  submit: string;
  sending: string;
  success: string;
  error: string;
  rateLimited: string;
  invalid: string;
};

export type ParamKey = "alpha" | "gamma" | "epsilonEnd" | "exploreFraction" | "lr";

// Text of the Training Lab page (/games/snake/lab)
export type TrainingLabText = {
  metaTitle: string;
  metaDescription: string;
  title: string;
  intro: string;
  form: {
    title: string;
    algorithm: string;
    episodes: string;
    episodesHint: (max: number) => string;
    paramsTitle: string;
    submit: string;
    submitting: string;
    queued: (id: number) => string;
    createdUnknown: string;
  };
  algorithms: Record<AlgorithmId, { name: string; description: string }>;
  params: Record<ParamKey, { label: string; help: string }>;
  fieldErrors: { not_a_number: string; out_of_range: (min: number, max: number) => string; not_integer: string };
  status: Record<RunStatus, string>;
  errors: Record<ErrorKind, string>;
  retryIn: (seconds: number) => string;
  gridLabel: (size: number) => string;
  runs: {
    title: string;
    empty: string;
    loading: string;
    // Numbers arrive already formatted for the locale
    progress: (done: string, total: string) => string;
    progressLabel: string;
    select: string;
    selected: string;
    downloadBrain: string;
    failedReason: string;
  };
  curve: {
    title: string;
    avg: string;
    best: string;
    xAxis: string;
    yAxis: string;
    noData: string;
    pick: string;
    description: string;
    summary: (points: string, lastEpisode: string, lastAvg: string, lastBest: string) => string;
  };
  compare: {
    title: string;
    caption: string;
    run: string;
    overall: string;
    baseline: string;
    baselineNote: string;
    pickTitle: string;
    maxPicked: (max: number) => string;
    empty: string;
    avgBest: string;
    bestMark: string;
    retry: string;
  };
};

export type Dictionary = {
  meta: { title: string; description: string };
  nav: { about: string; skills: string; projects: string; experience: string; knowledge: string; contact: string };
  hero: { greeting: string; viewWork: string; downloadCv: string };
  sections: { about: string; skills: string; projects: string; experience: string; knowledgeBase: string; contact: string };
  teamOf: (size: number) => string;
  contactText: string;
  contactForm: ContactFormLabels;
  languageLabel: string;
  menuLabel: string;
  closeMenuLabel: string;
  trainingLab: TrainingLabText;
};

export const DICTIONARIES: Localized<Dictionary> = {
  en: {
    meta: {
      title: "Nguyen Trung Huy — Front-End Engineer (React / Next.js)",
      description:
        "Front-End Developer with 7+ years of experience, many of them building websites for large Japanese clients with React, Next.js, Vue, Nuxt, GSAP and Three.js.",
    },
    nav: {
      about: "About",
      skills: "Skills",
      projects: "Projects",
      experience: "Experience",
      knowledge: "Knowledge",
      contact: "Contact",
    },
    hero: { greeting: "Hi, I'm", viewWork: "View work", downloadCv: "Download CV" },
    sections: {
      about: "About",
      skills: "Skills",
      projects: "Featured Work",
      experience: "Experience",
      knowledgeBase: "Knowledge Base",
      contact: "Contact",
    },
    teamOf: (size) => `Team of ${size}`,
    contactText: "Looking for Front-End roles. Also open to Fullstack opportunities — feel free to reach out. Based in Vietnam, working remotely with Japanese clients via a Vietnam-based company. Working language: English.",
    contactForm: {
      name: "Name",
      email: "Email",
      company: "Company (optional)",
      message: "Message",
      submit: "Send Message",
      sending: "Sending...",
      success: "Message sent successfully! Thank you for reaching out.",
      error: "An error occurred. Please try again.",
      rateLimited: "Too many requests. Please try again later.",
      invalid: "Please check your input and try again.",
    },
    languageLabel: "Language",
    menuLabel: "Menu",
    closeMenuLabel: "Close menu",
    trainingLab: {
      metaTitle: "Snake Training Lab — Nguyen Trung Huy",
      metaDescription: "Train your own Q-learning or DQN Snake agent on the server, watch the learning curve and compare it with the shipped brain.",
      title: "Snake Training Lab",
      intro: "Pick an algorithm and a few settings, and the server trains a Snake agent for you. Watch its learning curve while it runs, then compare the finished result with the brain used on the Snake page. Runs are queued and limited, so it can take a minute.",
      form: {
        title: "Start a training run",
        algorithm: "Algorithm",
        episodes: "Episodes",
        episodesHint: (max) => `1 to ${max}. More episodes learn more but take longer.`,
        paramsTitle: "Settings",
        submit: "Start training",
        submitting: "Sending...",
        queued: (id) => `Run #${id} queued.`,
        createdUnknown: "Run created. Refreshing the list...",
      },
      algorithms: {
        "q-learning": { name: "Q-learning", description: "A table of values for 2,048 hand-made situations. Fast to train, easy to understand." },
        dqn: { name: "DQN", description: "A small neural network that sees the area around the snake's head. Slower to train, works on any grid size." },
      },
      params: {
        alpha: { label: "Learning rate (alpha)", help: "How strongly each new experience overwrites old knowledge." },
        gamma: { label: "Discount (gamma)", help: "How much future rewards count compared with immediate ones." },
        epsilonEnd: { label: "Final exploration (epsilon)", help: "Share of random moves once exploration has faded." },
        exploreFraction: { label: "Exploration period", help: "Fraction of the episodes during which exploration fades out." },
        lr: { label: "Learning rate (lr)", help: "Step size of the neural network optimizer." },
      },
      fieldErrors: {
        not_a_number: "Enter a number.",
        out_of_range: (min, max) => `Must be between ${min} and ${max}.`,
        not_integer: "Must be a whole number.",
      },
      status: { queued: "Queued", running: "Running", succeeded: "Done", failed: "Failed", cancelled: "Cancelled" },
      errors: {
        rate_limited: "Too many requests. Please slow down.",
        queue_full: "The training queue is full right now.",
        client_limit: "You have reached your daily limit of training runs.",
        global_limit: "The lab has reached its daily limit of training runs.",
        invalid_field: "One of the values was rejected. Please check the form.",
        invalid_body: "The server could not read the request. Reload the page and try again.",
        forbidden_origin: "The request was blocked by the origin check. Reload the page and try again.",
        server_error: "Something went wrong on the server.",
        disabled: "The Training Lab is switched off.",
        network: "Could not reach the server. Check your connection.",
        not_found: "That run could not be found.",
      },
      retryIn: (seconds) => {
        const { unit, value } = humanizeDuration(seconds);
        const word = unit === "seconds" ? "second" : unit === "minutes" ? "minute" : "hour";
        return `Try again in ${value} ${word}${value === 1 ? "" : "s"}.`;
      },
      gridLabel: (size) => `Grid ${size}×${size}`,
      runs: {
        title: "Runs",
        empty: "No runs yet. Start the first one.",
        loading: "Loading runs...",
        progress: (done, total) => `${done} of ${total} episodes`,
        progressLabel: "Training progress",
        select: "Show run",
        selected: "Selected",
        downloadBrain: "Download brain JSON",
        failedReason: "Reason",
      },
      curve: {
        title: "Learning curve",
        avg: "Average score",
        best: "Best score",
        xAxis: "Episode",
        yAxis: "Score",
        noData: "No data yet. The curve appears after the first progress report.",
        pick: "Select a run to see its learning curve.",
        description: "Line chart of the average and the best score against the training episode.",
        summary: (points, lastEpisode, lastAvg, lastBest) => `${points} data points. At episode ${lastEpisode} the average score is ${lastAvg} and the best is ${lastBest}.`,
      },
      compare: {
        title: "Compare runs",
        caption: "Benchmark results per grid size: average and best score over the same seeded games.",
        run: "Run",
        overall: "Overall",
        baseline: "Baseline",
        baselineNote: "shipped brain",
        pickTitle: "Runs to compare",
        maxPicked: (max) => `You can compare up to ${max} runs.`,
        empty: "Finished runs appear here for comparison.",
        avgBest: "avg / best",
        bestMark: "highest in column",
        retry: "Retry",
      },
    },
  },
  ja: {
    meta: {
      title: "Nguyen Trung Huy — フロントエンドエンジニア（React / Next.js）",
      description:
        "React、Next.js、Vue、Nuxt、GSAP、Three.js を用いて、日本の大手クライアント向けに長年Webサイトの開発・保守を行っている、開発経験7年以上のフロントエンドエンジニア。",
    },
    nav: {
      about: "概要",
      skills: "スキル",
      projects: "実績",
      experience: "職歴",
      knowledge: "ナレッジ",
      contact: "連絡先",
    },
    hero: { greeting: "はじめまして", viewWork: "実績を見る", downloadCv: "CVをダウンロード" },
    sections: {
      about: "概要",
      skills: "スキル",
      projects: "主な実績",
      experience: "職歴",
      knowledgeBase: "ナレッジベース",
      contact: "連絡先",
    },
    teamOf: (size) => `チーム ${size}名`,
    contactText: "フロントエンド職を希望しています。フルスタックのポジションも歓迎します。お気軽にご連絡ください。ベトナム在住、ベトナムの会社を通じて日本のクライアントとリモートで業務を行っています。業務言語：英語。",
    contactForm: {
      name: "お名前",
      email: "メールアドレス",
      company: "会社名（任意）",
      message: "メッセージ",
      submit: "送信する",
      sending: "送信中...",
      success: "メッセージが正常に送信されました。ご連絡ありがとうございます。",
      error: "エラーが発生しました。もう一度お試しください。",
      rateLimited: "リクエストが多すぎます。後でもう一度お試しください。",
      invalid: "入力内容を確認してもう一度お試しください。",
    },
    languageLabel: "言語",
    menuLabel: "メニュー",
    closeMenuLabel: "メニューを閉じる",
    trainingLab: {
      metaTitle: "Snake トレーニングラボ — Nguyen Trung Huy",
      metaDescription: "Q-learning または DQN の Snake エージェントをサーバー上で学習させ、学習曲線を確認し、公開中のブレインと比較できます。",
      title: "Snake トレーニングラボ",
      intro: "アルゴリズムと設定を選ぶと、サーバーが Snake エージェントを学習させます。学習中は学習曲線を確認でき、完了後は Snake ページで使っているブレインと成績を比べられます。実行は順番待ちで回数にも上限があるため、結果が出るまで少し時間がかかります。",
      form: {
        title: "学習を開始する",
        algorithm: "アルゴリズム",
        episodes: "エピソード数",
        episodesHint: (max) => `1〜${max}。多いほどよく学びますが、時間もかかります。`,
        paramsTitle: "設定",
        submit: "学習を開始",
        submitting: "送信中...",
        queued: (id) => `実行 #${id} を受け付けました。`,
        createdUnknown: "実行を作成しました。一覧を更新しています...",
      },
      algorithms: {
        "q-learning": { name: "Q-learning", description: "手作りの 2,048 通りの状況ごとに価値を記録する表。学習が速く、仕組みも分かりやすい方式です。" },
        dqn: { name: "DQN", description: "ヘビの頭の周囲を見て判断する小さなニューラルネットワーク。学習は遅めですが、どのグリッドサイズでも動きます。" },
      },
      params: {
        alpha: { label: "学習率 (alpha)", help: "新しい経験で、これまでの知識をどれだけ書き換えるか。" },
        gamma: { label: "割引率 (gamma)", help: "目先の報酬に対して、将来の報酬をどれだけ重視するか。" },
        epsilonEnd: { label: "最終的な探索率 (epsilon)", help: "探索が落ち着いた後にランダムに動く割合。" },
        exploreFraction: { label: "探索期間", help: "探索を徐々に減らしていくエピソードの割合。" },
        lr: { label: "学習率 (lr)", help: "ニューラルネットワークの更新幅。" },
      },
      fieldErrors: {
        not_a_number: "数値を入力してください。",
        out_of_range: (min, max) => `${min}〜${max} の範囲で入力してください。`,
        not_integer: "整数で入力してください。",
      },
      status: { queued: "待機中", running: "学習中", succeeded: "完了", failed: "失敗", cancelled: "キャンセル" },
      errors: {
        rate_limited: "リクエストが多すぎます。少し間をおいてください。",
        queue_full: "現在、学習の順番待ちがいっぱいです。",
        client_limit: "1日に開始できる学習回数の上限に達しました。",
        global_limit: "ラボ全体の1日の学習回数の上限に達しました。",
        invalid_field: "入力値が受け付けられませんでした。内容を確認してください。",
        invalid_body: "サーバーがリクエストを読み取れませんでした。ページを再読み込みして、もう一度お試しください。",
        forbidden_origin: "オリジンの確認によりリクエストがブロックされました。ページを再読み込みして、もう一度お試しください。",
        server_error: "サーバーでエラーが発生しました。",
        disabled: "トレーニングラボは現在停止しています。",
        network: "サーバーに接続できません。通信環境を確認してください。",
        not_found: "指定された実行が見つかりません。",
      },
      retryIn: (seconds) => {
        const { unit, value } = humanizeDuration(seconds);
        return unit === "seconds" ? `${value}秒ほど待ってから、もう一度お試しください。` : `約${value}${unit === "minutes" ? "分" : "時間"}後に、もう一度お試しください。`;
      },
      gridLabel: (size) => `グリッド ${size}×${size}`,
      runs: {
        title: "実行一覧",
        empty: "まだ実行がありません。最初の学習を始めましょう。",
        loading: "読み込み中...",
        progress: (done, total) => `${done} / ${total} エピソード`,
        progressLabel: "学習の進行状況",
        select: "この実行を表示",
        selected: "選択中",
        downloadBrain: "ブレイン JSON をダウンロード",
        failedReason: "理由",
      },
      curve: {
        title: "学習曲線",
        avg: "平均スコア",
        best: "最高スコア",
        xAxis: "エピソード",
        yAxis: "スコア",
        noData: "まだデータがありません。最初の進捗報告のあとに曲線が表示されます。",
        pick: "実行を選ぶと学習曲線が表示されます。",
        description: "エピソードごとの平均スコアと最高スコアの折れ線グラフ。",
        summary: (points, lastEpisode, lastAvg, lastBest) => `データ点は ${points} 件。エピソード ${lastEpisode} 時点で、平均スコアは ${lastAvg}、最高スコアは ${lastBest} です。`,
      },
      compare: {
        title: "実行の比較",
        caption: "グリッドサイズ別のベンチマーク結果。同じ乱数シードのゲームでの平均スコアと最高スコアです。",
        run: "実行",
        overall: "総合",
        baseline: "基準",
        baselineNote: "公開中のブレイン",
        pickTitle: "比較する実行",
        maxPicked: (max) => `比較できるのは最大 ${max} 件までです。`,
        empty: "完了した実行がここに表示され、比較できます。",
        avgBest: "平均 / 最高",
        bestMark: "列内で最高",
        retry: "再試行",
      },
    },
  },
  vi: {
    meta: {
      title: "Nguyễn Trung Huy — Front-End Engineer (React / Next.js)",
      description:
        "Front-End Developer với hơn 7 năm kinh nghiệm, trong đó nhiều năm xây dựng website cho các khách hàng lớn tại Nhật Bản bằng React, Next.js, Vue, Nuxt, GSAP và Three.js.",
    },
    nav: {
      about: "Giới thiệu",
      skills: "Kỹ năng",
      projects: "Dự án",
      experience: "Kinh nghiệm",
      knowledge: "Kiến thức",
      contact: "Liên hệ",
    },
    hero: { greeting: "Xin chào, tôi là", viewWork: "Xem dự án", downloadCv: "Tải CV" },
    sections: {
      about: "Giới thiệu",
      skills: "Kỹ năng",
      projects: "Dự án tiêu biểu",
      experience: "Kinh nghiệm",
      knowledgeBase: "Kiến thức",
      contact: "Liên hệ",
    },
    teamOf: (size) => `Team ${size} người`,
    contactText: "Đang tìm vị trí Front-End. Cũng sẵn sàng nhận vị trí Fullstack — hãy liên hệ với tôi. Sống tại Việt Nam, làm việc remote với khách hàng Nhật thông qua công ty tại Việt Nam. Ngôn ngữ làm việc: tiếng Anh.",
    contactForm: {
      name: "Tên của bạn",
      email: "Email",
      company: "Công ty (không bắt buộc)",
      message: "Tin nhắn",
      submit: "Gửi tin nhắn",
      sending: "Đang gửi...",
      success: "Tin nhắn đã được gửi thành công. Cảm ơn bạn đã liên hệ.",
      error: "Có lỗi xảy ra. Vui lòng thử lại.",
      rateLimited: "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
      invalid: "Vui lòng kiểm tra thông tin và thử lại.",
    },
    languageLabel: "Ngôn ngữ",
    menuLabel: "Menu",
    closeMenuLabel: "Đóng menu",
    trainingLab: {
      metaTitle: "Phòng huấn luyện Snake — Nguyễn Trung Huy",
      metaDescription: "Huấn luyện agent Snake bằng Q-learning hoặc DQN ngay trên server, xem đường cong học và so sánh với bộ não đang dùng trên trang Snake.",
      title: "Phòng huấn luyện Snake",
      intro: "Chọn thuật toán và vài thiết lập, server sẽ huấn luyện một agent Snake cho bạn. Bạn có thể xem đường cong học trong lúc chạy, rồi so sánh kết quả với bộ não đang dùng ở trang Snake. Các lượt chạy được xếp hàng và có giới hạn nên có thể mất khoảng một phút.",
      form: {
        title: "Bắt đầu một lượt huấn luyện",
        algorithm: "Thuật toán",
        episodes: "Số ván huấn luyện",
        episodesHint: (max) => `Từ 1 đến ${max}. Càng nhiều ván càng học được nhiều nhưng càng lâu.`,
        paramsTitle: "Thiết lập",
        submit: "Bắt đầu huấn luyện",
        submitting: "Đang gửi...",
        queued: (id) => `Đã xếp hàng lượt chạy #${id}.`,
        createdUnknown: "Đã tạo lượt chạy. Đang làm mới danh sách...",
      },
      algorithms: {
        "q-learning": { name: "Q-learning", description: "Một bảng giá trị cho 2.048 tình huống tự định nghĩa. Huấn luyện nhanh, dễ hiểu." },
        dqn: { name: "DQN", description: "Mạng nơ-ron nhỏ quan sát vùng quanh đầu rắn. Huấn luyện chậm hơn nhưng chạy được trên mọi kích thước lưới." },
      },
      params: {
        alpha: { label: "Tốc độ học (alpha)", help: "Mức độ trải nghiệm mới ghi đè lên kiến thức cũ." },
        gamma: { label: "Hệ số chiết khấu (gamma)", help: "Phần thưởng tương lai được coi trọng đến đâu so với phần thưởng trước mắt." },
        epsilonEnd: { label: "Mức khám phá cuối (epsilon)", help: "Tỉ lệ đi ngẫu nhiên khi giai đoạn khám phá đã kết thúc." },
        exploreFraction: { label: "Giai đoạn khám phá", help: "Tỉ lệ số ván mà mức khám phá giảm dần." },
        lr: { label: "Tốc độ học (lr)", help: "Bước cập nhật của bộ tối ưu mạng nơ-ron." },
      },
      fieldErrors: {
        not_a_number: "Hãy nhập một số.",
        out_of_range: (min, max) => `Giá trị phải nằm trong khoảng ${min} đến ${max}.`,
        not_integer: "Phải là số nguyên.",
      },
      status: { queued: "Đang chờ", running: "Đang chạy", succeeded: "Hoàn tất", failed: "Thất bại", cancelled: "Đã hủy" },
      errors: {
        rate_limited: "Bạn gửi quá nhiều yêu cầu. Vui lòng chậm lại.",
        queue_full: "Hàng đợi huấn luyện hiện đã đầy.",
        client_limit: "Bạn đã dùng hết số lượt huấn luyện trong ngày.",
        global_limit: "Phòng huấn luyện đã hết số lượt trong ngày.",
        invalid_field: "Một giá trị bị từ chối. Vui lòng kiểm tra lại biểu mẫu.",
        invalid_body: "Server không đọc được yêu cầu. Hãy tải lại trang rồi thử lại.",
        forbidden_origin: "Yêu cầu bị chặn bởi kiểm tra nguồn gốc. Hãy tải lại trang rồi thử lại.",
        server_error: "Server gặp lỗi.",
        disabled: "Phòng huấn luyện đang tắt.",
        network: "Không kết nối được tới server. Hãy kiểm tra mạng.",
        not_found: "Không tìm thấy lượt chạy này.",
      },
      retryIn: (seconds) => {
        const { unit, value } = humanizeDuration(seconds);
        return `Hãy thử lại sau ${value} ${unit === "seconds" ? "giây" : unit === "minutes" ? "phút" : "giờ"}.`;
      },
      gridLabel: (size) => `Lưới ${size}×${size}`,
      runs: {
        title: "Các lượt chạy",
        empty: "Chưa có lượt chạy nào. Hãy bắt đầu lượt đầu tiên.",
        loading: "Đang tải...",
        progress: (done, total) => `${done} / ${total} ván`,
        progressLabel: "Tiến độ huấn luyện",
        select: "Xem lượt chạy",
        selected: "Đang chọn",
        downloadBrain: "Tải JSON bộ não",
        failedReason: "Lý do",
      },
      curve: {
        title: "Đường cong học",
        avg: "Điểm trung bình",
        best: "Điểm cao nhất",
        xAxis: "Ván",
        yAxis: "Điểm",
        noData: "Chưa có dữ liệu. Đường cong sẽ hiện sau báo cáo tiến độ đầu tiên.",
        pick: "Chọn một lượt chạy để xem đường cong học.",
        description: "Biểu đồ đường thể hiện điểm trung bình và điểm cao nhất theo từng ván huấn luyện.",
        summary: (points, lastEpisode, lastAvg, lastBest) => `${points} điểm dữ liệu. Tại ván ${lastEpisode}, điểm trung bình là ${lastAvg} và điểm cao nhất là ${lastBest}.`,
      },
      compare: {
        title: "So sánh các lượt chạy",
        caption: "Kết quả benchmark theo kích thước lưới: điểm trung bình và cao nhất trên cùng các ván chơi có seed cố định.",
        run: "Lượt chạy",
        overall: "Tổng thể",
        baseline: "Mốc chuẩn",
        baselineNote: "bộ não đang dùng",
        pickTitle: "Chọn lượt chạy để so sánh",
        maxPicked: (max) => `Chỉ so sánh được tối đa ${max} lượt chạy.`,
        empty: "Các lượt chạy đã hoàn tất sẽ hiện ở đây để so sánh.",
        avgBest: "TB / cao nhất",
        bestMark: "cao nhất trong cột",
        retry: "Thử lại",
      },
    },
  },
};
