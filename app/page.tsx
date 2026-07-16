import type { Metadata } from "next";
import { HomeworkPlatform } from "./components/homework-platform";

export const metadata: Metadata = {
  title: { absolute: "学业闭环 · 暑假作业管理" },
  description: "连接作业计划、独立练习、家教批改、订正复做与学校提交的家庭学习平台。",
};

export default function Home() {
  return <HomeworkPlatform />;
}
