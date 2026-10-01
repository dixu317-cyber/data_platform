import Link from "next/link";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap wrap-wide">
        <div className="site-footer-top">
          <div className="site-footer-brand">
            <Logo />
            <p>
              CoworkExpress 平台。把散落的知识，变成员工随时能问、答案带依据、管理员管得住的可信资产。
            </p>
          </div>
          <div className="site-footer-cols">
            <div>
              <h5>前台 · 业务消费</h5>
              <Link href="/app">问公司大脑</Link>
              <Link href="/app/knowledge">Agent 空间</Link>
              <Link href="/app/settings">我的设置</Link>
            </div>
            <div>
              <h5>后台 · Agent 管理</h5>
              <Link href="/admin">Agent</Link>
              <Link href="/admin/new">新建 Agent</Link>
              <Link href="/admin/diagnostics">运行与诊断</Link>
            </div>
            <div>
              <h5>方案</h5>
              <a href="#scenarios">个人 Agent</a>
              <a href="#scenarios">关系 Agent</a>
              <a href="#scenarios">文档 Agent</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
