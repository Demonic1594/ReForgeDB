# Android Installation
This guide assumes you already run ForgeScript on Android with Termux (and, optionally, Acode). The default `sqlite3` driver has to be compiled on the device, which needs one extra file.

1. In your Termux `Home` directory run:
```bash
mkdir -p .gyp
echo "{'variables':{'android_ndk_path': ''}}" > .gyp/include.gypi
```

2. Then, in your project, run:
```bash
npm i github:Demonic1594/ReForgeDB sqlite3
```

> [!IMPORTANT]
> Storing data on a phone is not recommended. If you do not have a computer, use a VPS, or a hosted database (`postgres`, `mysql`/`mariadb` or `mongodb`), which needs no compiling on the device.
