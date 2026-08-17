<script setup lang="ts">
import { computed } from "vue";

interface KconfigNode {
  id: string;
  title?: string;
  type: "menu" | "choice" | "bool" | "int" | "hex" | "string";
  children: KconfigNode[];
}

const props = defineProps<{ node: KconfigNode; selectedId: string; expanded: Set<string>; depth?: number }>();
const emit = defineEmits<{ select: [node: KconfigNode]; toggle: [id: string] }>();
const menuChildren = computed(() => props.node.children.filter((child) => child.type === "menu" && child.title));
const isExpanded = computed(() => props.expanded.has(props.node.id));
</script>

<template>
  <div class="k-tree-branch">
    <div class="k-tree-row" :class="{ selected: selectedId === node.id }" :style="{ '--tree-depth': depth || 0 }">
      <button v-if="menuChildren.length" class="k-tree-toggle" :aria-label="isExpanded ? '折叠' : '展开'" @click.stop="emit('toggle', node.id)">{{ isExpanded ? '⌄' : '›' }}</button>
      <span v-else class="k-tree-spacer"></span>
      <button class="k-tree-label" :title="node.title" @click="emit('select', node)">{{ node.title }}</button>
    </div>
    <div v-if="isExpanded" class="k-tree-children">
      <KconfigTreeNode v-for="child in menuChildren" :key="child.id" :node="child" :selected-id="selectedId" :expanded="expanded" :depth="(depth || 0) + 1" @select="emit('select', $event)" @toggle="emit('toggle', $event)" />
    </div>
  </div>
</template>
