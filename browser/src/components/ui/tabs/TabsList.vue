<script setup lang="ts">
import type { TabsListProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TabsList as TabsListRoot } from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<TabsListProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <TabsListRoot
    data-slot="tabs-list"
    v-bind="delegatedProps"
    :class="
      cn(
        'inline-flex h-11 items-center justify-center rounded-lg bg-white/5 p-1 text-white/60 border border-white/10',
        props.class,
      )
    "
  >
    <slot />
  </TabsListRoot>
</template>
