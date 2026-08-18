<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ state: AppUpdateState }>();
const emit = defineEmits<{
  check: [];
  download: [];
  retry: [];
  install: [];
  manual: [];
  copyError: [];
  minimize: [];
  dismiss: [];
}>();

const busy = computed(() => props.state.phase === "checking" || props.state.phase === "downloading");
const roundedPercent = computed(() => Math.max(0, Math.min(100, Math.round(props.state.percent || 0))));
const phaseTitle = computed(() => ({
  idle: "软件更新",
  checking: "正在检查更新",
  available: "发现新版本",
  downloading: "正在下载更新",
  downloaded: "更新已准备好",
  "up-to-date": "已是最新版本",
  error: "更新未完成",
  unsupported: "当前模式不支持自动更新"
}[props.state.phase]));

function formatBytes(value?: number) {
  const amount = Math.max(0, value || 0);
  if (amount < 1024) return `${Math.round(amount)} B`;
  if (amount < 1024 ** 2) return `${(amount / 1024).toFixed(1)} KB`;
  if (amount < 1024 ** 3) return `${(amount / 1024 ** 2).toFixed(1)} MB`;
  return `${(amount / 1024 ** 3).toFixed(2)} GB`;
}

function formatEta(value?: number) {
  if (!value || !Number.isFinite(value)) return "正在计算";
  if (value < 60) return `约 ${Math.max(1, Math.ceil(value))} 秒`;
  const minutes = Math.ceil(value / 60);
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `约 ${hours} 小时 ${minutes % 60} 分钟`;
}
</script>

<template>
  <section class="update-card" role="status" aria-live="polite" aria-label="软件更新状态">
    <header>
      <div class="update-card-icon"><i :class="['codicon', state.phase === 'error' ? 'codicon-error' : state.phase === 'downloaded' ? 'codicon-pass-filled' : 'codicon-cloud-download']" /></div>
      <div>
        <p class="section-kicker">Application update</p>
        <h2>{{ phaseTitle }}</h2>
      </div>
      <button v-if="state.phase === 'downloading'" class="update-card-close" title="收起到侧边栏" aria-label="收起到侧边栏" @click="emit('minimize')"><i class="codicon codicon-chrome-minimize" /></button>
      <button v-else-if="!busy" class="update-card-close" title="关闭更新提示" aria-label="关闭更新提示" @click="emit('dismiss')"><i class="codicon codicon-close" /></button>
    </header>

    <p class="update-message">{{ state.message }}</p>
    <p v-if="state.availableVersion" class="update-version">v{{ state.currentVersion }} <i class="codicon codicon-arrow-right" /> v{{ state.availableVersion }}</p>

    <template v-if="state.phase === 'downloading'">
      <div class="update-progress-heading"><strong>{{ roundedPercent }}%</strong><span>{{ formatBytes(state.transferred) }} / {{ state.total ? formatBytes(state.total) : '大小计算中' }}</span></div>
      <div class="update-progress" role="progressbar" aria-label="更新下载进度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="roundedPercent"><span :style="{ width: `${roundedPercent}%` }" /></div>
      <dl class="update-metrics">
        <div><dt>下载速度</dt><dd>{{ state.bytesPerSecond ? `${formatBytes(state.bytesPerSecond)}/s` : '正在连接' }}</dd></div>
        <div><dt>预计剩余</dt><dd>{{ formatEta(state.etaSeconds) }}</dd></div>
      </dl>
    </template>

    <div v-if="state.error" class="update-error"><i class="codicon codicon-warning" /><span>{{ state.error }}</span></div>

    <footer>
      <button v-if="state.phase === 'idle' || state.phase === 'up-to-date'" class="primary" @click="emit('check')"><i class="codicon codicon-refresh" />检查更新</button>
      <button v-if="state.phase === 'available'" class="primary" @click="emit('download')"><i class="codicon codicon-cloud-download" />下载更新</button>
      <button v-if="state.phase === 'downloading'" class="secondary" @click="emit('minimize')"><i class="codicon codicon-chevron-down" />收起后台</button>
      <button v-if="state.phase === 'downloaded'" class="primary" @click="emit('install')"><i class="codicon codicon-debug-restart" />重启并安装</button>
      <button v-if="state.phase === 'error'" class="primary" @click="emit('retry')"><i class="codicon codicon-refresh" />重试</button>
      <button v-if="state.phase === 'error' || state.phase === 'unsupported'" class="secondary" @click="emit('manual')"><i class="codicon codicon-link-external" />手动下载</button>
      <button v-if="state.phase === 'error'" class="secondary" @click="emit('copyError')"><i class="codicon codicon-copy" />复制错误</button>
    </footer>
  </section>
</template>
