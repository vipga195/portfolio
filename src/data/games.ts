import type { Localized } from "@/i18n/config";

export type GameStatus = "playable" | "in-development";

export type GameEntry = {
  id: string;
  name: string;
  // Site path (without locale prefix); omitted while there is nothing to open yet
  path?: string;
  status: GameStatus;
  summary: Localized;
  tags: string[];
  // Entry is listed only while the training feature flag is on
  requiresTraining?: boolean;
};

// Add a game here and it shows up on /games
export const GAMES: GameEntry[] = [
  {
    id: "snake",
    name: "Snake AI",
    path: "/games/snake",
    status: "playable",
    summary: {
      en: "Play Snake yourself or watch a Q-learning agent trained in TypeScript play it in the browser.",
      ja: "スネークゲームを自分で遊ぶか、TypeScriptで学習させたQ学習エージェントのプレイをブラウザで観戦できます。",
      vi: "Tự chơi Snake hoặc xem agent Q-learning huấn luyện bằng TypeScript chơi ngay trên trình duyệt.",
    },
    tags: ["Q-learning", "DQN", "TypeScript"],
  },
  {
    id: "fighter",
    name: "Stick Fighter Duel",
    path: "/games/fighter",
    status: "playable",
    summary: {
      en: "A 1v1 stick-figure polearm duel against a scripted opponent with three difficulty levels. Keyboard and touch controls.",
      ja: "棒人間の長柄武器による1対1の対戦。3段階の難易度のスクリプトNPCと戦います。キーボードとタッチ操作に対応。",
      vi: "Đấu tay đôi người que dùng vũ khí dài với NPC theo luật, có 3 mức độ khó. Hỗ trợ bàn phím và cảm ứng.",
    },
    tags: ["Deterministic sim", "Canvas", "TypeScript"],
  },
  {
    id: "fighter-world",
    name: "Stick Fighter Open World",
    path: "/games/fighter/world",
    status: "in-development",
    summary: {
      en: "An isometric sandbox where you fight a general in an open arena. Early prototype of a larger scrolling world.",
      ja: "アイソメトリック視点のサンドボックスで将軍と戦います。大きなスクロールワールドの初期プロトタイプです。",
      vi: "Sandbox góc nhìn isometric, đấu với một tướng trong đấu trường mở. Bản thử nghiệm đầu của thế giới mở cuộn lớn hơn.",
    },
    tags: ["Isometric", "Canvas", "TypeScript"],
  },
  {
    id: "snake-lab",
    name: "Snake Training Lab",
    path: "/games/snake/lab",
    status: "in-development",
    summary: {
      en: "Train your own Q-learning or DQN Snake agent on the server and compare it with the shipped brain.",
      ja: "Q-learning または DQN の Snake エージェントをサーバー上で学習させ、公開中のブレインと比較できます。",
      vi: "Huấn luyện agent Snake bằng Q-learning hoặc DQN trên server và so sánh với bộ não đang dùng.",
    },
    tags: ["Training", "PostgreSQL", "Worker"],
    requiresTraining: true,
  },
];
