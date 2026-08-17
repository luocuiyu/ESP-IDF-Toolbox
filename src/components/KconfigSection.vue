<script setup lang="ts">
import { computed, ref } from "vue";

type KconfigValue = boolean | number | string;
interface KconfigNode {
  id: string;
  name?: string;
  title?: string;
  type: "menu" | "choice" | "bool" | "int" | "hex" | "string";
  help?: string;
  depends_on?: string;
  children: KconfigNode[];
}

const props = defineProps<{
  node: KconfigNode;
  values: Record<string, KconfigValue>;
  ranges: Record<string, [number, number]>;
  visible: Record<string, boolean>;
  changed: Set<string>;
  level?: number;
}>();
const emit = defineEmits<{ change: [name: string, value: KconfigValue, immediate?: boolean, localValues?: Record<string, KconfigValue>]; reset: [node: KconfigNode] }>();
const helpOpen = ref(false);
const visibleChildren = computed(() => props.node.children.filter((child) => props.visible[child.id] !== false && child.title));
const selectedChoice = computed(() => props.node.children.find((child) => child.name && props.values[child.name] === true)?.name || "");
const nodeChanged = computed(() => props.node.type === "choice"
  ? props.node.children.some((child) => child.name && props.changed.has(child.name))
  : Boolean(props.node.name && props.changed.has(props.node.name)));

function updateText(event: Event) {
  if (!props.node.name) return;
  const raw = (event.target as HTMLInputElement).value;
  const value = props.node.type === "int"
    ? (raw.trim() === "" ? (props.ranges[props.node.name]?.[0] ?? 0) : Number(raw))
    : (props.node.type === "hex" && raw.trim() === "" ? "0" : raw);
  emit("change", props.node.name, value, false);
}
function updateChoice(event: Event) {
  const selected = (event.target as HTMLSelectElement).value;
  if (!selected) return;
  // Keep the select visually responsive while confserver calculates and returns
  // the authoritative mutual-exclusion diff. Only the selected symbol is sent.
  const localValues: Record<string, KconfigValue> = {};
  for (const child of props.node.children) if (child.name) localValues[child.name] = child.name === selected;
  emit("change", selected, true, true, localValues);
}
function forwardChange(name: string, value: KconfigValue, immediate?: boolean, localValues?: Record<string, KconfigValue>) { emit("change", name, value, immediate, localValues); }
</script>

<template>
  <section v-if="node.type === 'menu'" class="k-section" :class="`level-${Math.min(level || 0, 3)}`" :data-section-id="node.id">
    <header class="k-section-title"><h3>{{ node.title }}</h3><button v-if="node.help" class="k-info-button" :class="{ active: helpOpen }" title="显示帮助" @click="helpOpen = !helpOpen">i</button></header>
    <p v-if="helpOpen && node.help" class="k-help">{{ node.help }}</p>
    <KconfigSection v-for="child in visibleChildren" :key="child.id" :node="child" :values="values" :ranges="ranges" :visible="visible" :changed="changed" :level="(level || 0) + 1" @change="forwardChange" @reset="emit('reset', $event)" />
  </section>

  <template v-else>
    <div class="k-option" :class="{ changed: nodeChanged }" :data-kconfig-name="node.name || undefined">
      <div class="k-option-copy">
        <div class="k-option-heading"><strong>{{ node.title || node.name }}</strong><button v-if="node.help" class="k-info-button" :class="{ active: helpOpen }" title="显示帮助" @click="helpOpen = !helpOpen">i</button><button v-if="nodeChanged" class="k-reset-button" title="撤销此项修改" @click="emit('reset', node)">↶</button></div>
        <code v-if="node.name">CONFIG_{{ node.name }}</code>
        <p v-if="helpOpen && node.help" class="k-help">{{ node.help }}</p>
        <small v-if="helpOpen && node.depends_on">依赖：{{ node.depends_on }}</small>
      </div>
      <label v-if="node.type === 'bool'" class="kconfig-switch"><input type="checkbox" :checked="Boolean(values[node.name || ''])" @change="node.name && emit('change', node.name, ($event.target as HTMLInputElement).checked, true)" /><span></span><b>{{ values[node.name || ''] ? '启用' : '关闭' }}</b></label>
      <select v-else-if="node.type === 'choice'" class="kconfig-control" :value="selectedChoice" @change="updateChoice"><option v-for="choice in visibleChildren.filter((item) => item.name)" :key="choice.id" :value="choice.name">{{ choice.title || choice.name }}</option></select>
      <div v-else class="kconfig-value"><input class="kconfig-control" :type="node.type === 'int' ? 'number' : 'text'" :min="node.name ? ranges[node.name]?.[0] : undefined" :max="node.name ? ranges[node.name]?.[1] : undefined" :value="values[node.name || '']" @input="updateText" /><small v-if="node.name && ranges[node.name]">范围 {{ ranges[node.name][0] }}–{{ ranges[node.name][1] }}</small></div>
    </div>
    <div v-if="node.type !== 'choice' && visibleChildren.length" class="k-option-children">
      <KconfigSection v-for="child in visibleChildren" :key="child.id" :node="child" :values="values" :ranges="ranges" :visible="visible" :changed="changed" :level="(level || 0) + 1" @change="forwardChange" @reset="emit('reset', $event)" />
    </div>
  </template>
</template>
