"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { Logo } from "../site/logo";
import { ThemeToggle } from "../theme-provider";
import {
  describeApiError,
  platformApi,
  type RegistrationTeam,
} from "../../lib/api";

export type LoginMode = "login" | "register";
export type RegistrationTeamLoadState = "idle" | "loading" | "ready" | "error";

export function RegistrationTeamSection({
  mode,
  state,
  teams,
  selectedTeamId,
  onChange,
  onRetry,
}: {
  mode: LoginMode;
  state: RegistrationTeamLoadState;
  teams: RegistrationTeam[];
  selectedTeamId: string;
  onChange: (teamId: string) => void;
  onRetry: () => void;
}) {
  if (mode !== "register") return null;
  if (state === "loading" || state === "idle") {
    return (
      <div className="auth-team-field" aria-live="polite">
        <span>团队（选填）</span>
        <p>正在加载可注册团队…</p>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="auth-team-field">
        <span>团队（选填）</span>
        <p className="auth-team-error" role="alert">团队列表加载失败。</p>
        <p>未选择团队时，将由服务分配数据库默认团队。</p>
        <button type="button" className="auth-team-retry" onClick={onRetry}>重新加载</button>
      </div>
    );
  }
  return (
    <label className="auth-team-field">
      <span>团队（选填）</span>
      <select
        name="team_id"
        value={selectedTeamId}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">未选择，将加入默认团队</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>{team.name}</option>
        ))}
      </select>
    </label>
  );
}

export function LoginPage({ nextPath, reason }: { nextPath: string; reason?: string }) {
  const router = useRouter();
  const auth = useAuth();
  const [mode, setMode] = useState<LoginMode>("login");
  const [username, setUsername] = useState("muyu");
  const [displayName, setDisplayName] = useState("木羽");
  const [password, setPassword] = useState("muyu123456");
  const [error, setError] = useState("");
  const [registrationTeams, setRegistrationTeams] = useState<RegistrationTeam[]>([]);
  const [registrationTeamState, setRegistrationTeamState] =
    useState<RegistrationTeamLoadState>("idle");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [registrationTeamRequest, setRegistrationTeamRequest] = useState(0);
  const needsAdmin = reason === "admin" || nextPath.startsWith("/admin");
  const busy = auth.state === "loading";

  useEffect(() => {
    if (auth.state !== "authenticated") return;
    if (needsAdmin && !auth.user?.is_admin) return;
    router.replace(nextPath);
  }, [auth.state, auth.user?.is_admin, needsAdmin, nextPath, router]);

  useEffect(() => {
    if (mode !== "register") {
      setRegistrationTeamState("idle");
      setRegistrationTeams([]);
      setSelectedTeamId("");
      return;
    }
    const controller = new AbortController();
    setRegistrationTeamState("loading");
    setRegistrationTeams([]);
    setSelectedTeamId("");
    void platformApi.registrationTeams(controller.signal).then(
      (response) => {
        setRegistrationTeams(response.teams);
        setRegistrationTeamState("ready");
      },
      (requestError) => {
        if (controller.signal.aborted) return;
        setRegistrationTeams([]);
        setSelectedTeamId("");
        setRegistrationTeamState("error");
        setError(describeApiError(requestError));
      },
    );
    return () => controller.abort();
  }, [mode, registrationTeamRequest]);

  const helper = useMemo(() => {
    if (needsAdmin && auth.user && !auth.user.is_admin) return "当前账号没有后台管理权限，请切换管理员账号。";
    if (needsAdmin) return "后台会校验管理员角色；普通成员只能进入前台工作区。";
    return "登录后会回到你刚才要进入的页面，刷新页面也会保持登录态。";
  }, [auth.user, needsAdmin]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      if (mode === "register") {
        await auth.register({
          username,
          password,
          displayName,
          teamId: selectedTeamId || undefined,
        });
      }
      else await auth.login({ username, password });
      await auth.refresh();
      router.replace(nextPath);
    } catch (error) {
      setError(describeApiError(error));
    }
  }

  function fillAccount(nextUsername: string, nextPassword: string, nextName: string) {
    setMode("login");
    setUsername(nextUsername);
    setPassword(nextPassword);
    setDisplayName(nextName);
    setError("");
  }

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <header className="auth-topbar">
          <Link href="/" aria-label="返回官网"><Logo size={28} /></Link>
          <ThemeToggle />
        </header>

        <div className="auth-grid">
          <section className="auth-copy">
            <span>账号与权限</span>
            <h1>确认身份后，进入 Agent 中台。</h1>
            <p>前台、后台、个人资料、团队资料和公司级 Agent 调度都会经过同一套权限边界。</p>
            <div className="auth-policy-list">
              <article><b>前台成员</b><small>创建个人或团队场景，查看自己可访问的任务和知识。</small></article>
              <article><b>后台管理员</b><small>接收资料请求，确认入库方式，控制公司级发布范围。</small></article>
              <article><b>召回边界</b><small>个人、团队、公司级知识在 API 层过滤，不靠页面隐藏。</small></article>
            </div>
          </section>

          <section className="auth-card" aria-label="登录">
            <div className="auth-card-head">
              <div>
                <span>{needsAdmin ? "管理员入口" : "前台入口"}</span>
                <h2>{mode === "login" ? "登录账号" : "创建成员账号"}</h2>
              </div>
              <div className="auth-mode-switch">
                <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button>
                <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>注册</button>
              </div>
            </div>

            <p className="auth-helper">{helper}</p>

            <form className="auth-form" onSubmit={submit}>
              <label>
                <span>账号</span>
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
              </label>
              {mode === "register" && (
                <label>
                  <span>显示名称</span>
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
                </label>
              )}
              <RegistrationTeamSection
                mode={mode}
                state={registrationTeamState}
                teams={registrationTeams}
                selectedTeamId={selectedTeamId}
                onChange={setSelectedTeamId}
                onRetry={() => {
                  setError("");
                  setRegistrationTeamRequest((value) => value + 1);
                }}
              />
              <label>
                <span>密码</span>
                <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} />
              </label>
              {(error || auth.message) && <p className="auth-error" role="alert">{error || auth.message}</p>}
              <button
                className="auth-submit"
                type="submit"
                disabled={
                  busy
                  || registrationTeamState === "loading"
                  || !username.trim()
                  || password.length < 8
                }
              >
                {busy ? "正在验证" : mode === "login" ? "进入系统" : "创建并进入"}
              </button>
            </form>

            <div className="auth-demo-row" aria-label="内置账号">
              <button type="button" onClick={() => fillAccount("muyu", "muyu123456", "木羽")}>成员账号</button>
              <button type="button" onClick={() => fillAccount("admin", "admin123456", "管理员")}>管理员账号</button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
