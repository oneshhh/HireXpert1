import os
import ffmpeg

# Set your FFmpeg path
ffmpeg_path = r"C:\ffmpeg-2025-11-24-git-c732564d2e-full_build\ffmpeg-2025-11-24-git-c732564d2e-full_build\bin"
os.environ["PATH"] += os.pathsep + ffmpeg_path
os.environ["FFMPEG_BINARY"] = fr"{ffmpeg_path}\ffmpeg.exe"
os.environ["FFPROBE_BINARY"] = fr"{ffmpeg_path}\ffprobe.exe"


def compress_video(input_path, output_path, video_bitrate, audio_bitrate):
    (
        ffmpeg
        .input(input_path)
        .output(
            output_path,
            vcodec="libx264",
            video_bitrate=video_bitrate,
            acodec="aac",
            audio_bitrate=audio_bitrate,
            preset="medium"
        )
        .overwrite_output()
        .run()
    )


    print("✅ Done! Compressed file saved as:", output_path)


compress_video("input.mp4", "output_50-percent.mp4", "5650k", "96k")
compress_video("input.mp4", "output_40-percent.mp4", "4520k", "80k")
compress_video("input.mp4", "output_30-percent.mp4", "3390k", "64k")
