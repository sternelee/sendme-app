package io.sendme.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class SendmeForegroundService : Service() {
  private val notificationManager by lazy {
    getSystemService(NotificationManager::class.java)
  }
  private var foregroundStarted = false

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_UPSERT -> {
        val payload = intent.getStringExtra(EXTRA_PAYLOAD)
        val session = payload?.let(NotificationSession::fromJson)
        if (session == null) {
          stopForeground(STOP_FOREGROUND_REMOVE)
          stopSelf()
          return START_NOT_STICKY
        }

        val notification = buildNotification(session)
        if (!foregroundStarted) {
          foregroundStarted = true
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
              NOTIFICATION_ID,
              notification,
              ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
          } else {
            startForeground(NOTIFICATION_ID, notification)
          }
        } else {
          notificationManager.notify(NOTIFICATION_ID, notification)
        }
      }

      ACTION_STOP -> {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }

    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    foregroundStarted = false
    super.onDestroy()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val channel =
      NotificationChannel(
        CHANNEL_ID,
        getString(R.string.foreground_channel_name),
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = getString(R.string.foreground_channel_description)
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }

    notificationManager.createNotificationChannel(channel)
  }

  private fun buildNotification(session: NotificationSession): Notification {
    val launchIntent =
      packageManager.getLaunchIntentForPackage(packageName)?.apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      } ?: Intent(this, MainActivity::class.java)

    val pendingIntent =
      PendingIntent.getActivity(
        this,
        0,
        launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentImmutableFlag(),
      )

    val builder =
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(applicationInfo.icon)
        .setContentTitle(session.title.ifBlank { getString(R.string.app_name) })
        .setContentText(session.message)
        .setStyle(
          NotificationCompat.BigTextStyle().bigText(
            buildString {
              append(session.message)
              if (session.detail.isNotBlank()) {
                append('\n')
                append(session.detail)
              }
            },
          ),
        )
        .setContentIntent(pendingIntent)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)

    when {
      session.progressMax > 0 -> {
        builder.setProgress(session.progressMax, session.progressCurrent.coerceIn(0, session.progressMax), session.indeterminate)
      }

      session.indeterminate -> {
        builder.setProgress(0, 0, true)
      }

      else -> {
        builder.setProgress(0, 0, false)
      }
    }

    return builder.build()
  }

  private fun pendingIntentImmutableFlag(): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      PendingIntent.FLAG_IMMUTABLE
    } else {
      0
    }
  }

  private data class NotificationSession(
    val title: String,
    val message: String,
    val detail: String,
    val progressCurrent: Int,
    val progressMax: Int,
    val indeterminate: Boolean,
  ) {
    companion object {
      fun fromJson(payloadJson: String): NotificationSession? {
        return runCatching {
          val payload = JSONObject(payloadJson)
          NotificationSession(
            title = payload.optString("title"),
            message = payload.optString("message"),
            detail = payload.optString("detail"),
            progressCurrent = payload.optInt("progressCurrent", 0),
            progressMax = payload.optInt("progressMax", 0),
            indeterminate = payload.optBoolean("indeterminate", false),
          )
        }.getOrNull()
      }
    }
  }

  companion object {
    private const val CHANNEL_ID = "sendme-background"
    private const val NOTIFICATION_ID = 1001
    private const val ACTION_UPSERT = "io.sendme.app.action.UPSERT_FOREGROUND"
    private const val ACTION_STOP = "io.sendme.app.action.STOP_FOREGROUND"
    private const val EXTRA_PAYLOAD = "payload"

    @JvmStatic
    fun upsert(context: Context, payloadJson: String) {
      val intent =
        Intent(context, SendmeForegroundService::class.java).apply {
          action = ACTION_UPSERT
          putExtra(EXTRA_PAYLOAD, payloadJson)
        }
      ContextCompat.startForegroundService(context, intent)
    }

    @JvmStatic
    fun stop(context: Context) {
      context.stopService(Intent(context, SendmeForegroundService::class.java))
    }
  }
}
