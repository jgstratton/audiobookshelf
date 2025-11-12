<template>
  <tr>
    <td class="px-4">
      {{ showFullPath ? file.metadata.path : file.metadata.relPath }}
    </td>
    <td>
      {{ $bytesPretty(file.metadata.size) }}
    </td>
    <td class="text-xs">
      <div class="flex items-center">
        <p>{{ file.fileType }}</p>
      </div>
    </td>
    <td v-if="contextMenuItems.length" class="text-center">
      <ui-context-menu-dropdown :items="contextMenuItems" :menu-width="110" @action="contextMenuAction" />
    </td>
    <td v-if="userIsAdmin" class="text-center">
      <ui-tooltip :text="$strings.LabelSaveToCloud" direction="top">
        <ui-icon-btn icon="cloud_upload" class="mx-0.5" :aria-label="$strings.LabelSaveToCloud" :loading="savingsToCloud" outlined @click="saveToCloud" />
      </ui-tooltip>
    </td>
  </tr>
</template>

<script>
export default {
  props: {
    libraryItemId: String,
    showFullPath: Boolean,
    file: {
      type: Object,
      default: () => {}
    },
    inModal: Boolean
  },
  data() {
    return { savingsToCloud: false }
  },
  computed: {
    userToken() {
      return this.$store.getters['user/getToken']
    },
    userCanDownload() {
      return this.$store.getters['user/getUserCanDownload']
    },
    userCanDelete() {
      return this.$store.getters['user/getUserCanDelete']
    },
    userIsAdmin() {
      return this.$store.getters['user/getIsAdminOrUp']
    },
    downloadUrl() {
      return `${process.env.serverUrl}/api/items/${this.libraryItemId}/file/${this.file.ino}/download?token=${this.userToken}`
    },
    contextMenuItems() {
      const items = []
      if (this.userCanDownload) {
        items.push({
          text: this.$strings.LabelDownload,
          action: 'download'
        })
      }
      if (this.userCanDelete) {
        items.push({
          text: this.$strings.ButtonDelete,
          action: 'delete'
        })
      }
      // Currently not showing this option in the Files tab modal
      if (this.userIsAdmin && this.file.audioFile && !this.inModal) {
        items.push({
          text: this.$strings.LabelMoreInfo,
          action: 'more'
        })
      }
      return items
    }
  },
  methods: {
    contextMenuAction({ action }) {
      if (action === 'delete') {
        this.deleteLibraryFile()
      } else if (action === 'download') {
        this.downloadLibraryFile()
      } else if (action === 'more') {
        this.$emit('showMore', this.file.audioFile)
      }
    },
    deleteLibraryFile() {
      const payload = {
        message: this.$strings.MessageConfirmDeleteFile,
        callback: (confirmed) => {
          if (confirmed) {
            this.$axios
              .$delete(`/api/items/${this.libraryItemId}/file/${this.file.ino}`)
              .then(() => {
                this.$toast.success(this.$strings.ToastDeleteFileSuccess)
              })
              .catch((error) => {
                console.error('Failed to delete file', error)
                this.$toast.error(this.$strings.ToastDeleteFileFailed)
              })
          }
        },
        type: 'yesNo'
      }
      this.$store.commit('globals/setConfirmPrompt', payload)
    },
    downloadLibraryFile() {
      this.$downloadFile(this.downloadUrl, this.file.metadata.filename)
    },
    async saveToCloud() {
      if (this.savingsToCloud) return

      this.savingsToCloud = true

      try {
        const response = await this.$axios.$get(`/api/items/${this.libraryItemId}/file/${this.file.ino}/saveToCloud`, {
          timeout: 300000
        })

        if (response.success) {
          this.$toast.success(`Successfully saved "${response.fileName}" to cloud storage`)
        } else {
          this.$toast.error('Failed to save to cloud')
        }
      } catch (error) {
        console.error('Failed to save to cloud', error)
        const errorMessage = error.response?.data?.message || error.message || 'Failed to save to cloud'
        this.$toast.error(errorMessage)
      } finally {
        this.savingsToCloud = false
      }
    }
  },
  mounted() {}
}
</script>
