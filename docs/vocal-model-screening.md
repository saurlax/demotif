# Native singing model screening

Checked: 2026-11-04. Implementation task 1.1. This report records inspected metadata, not a working synthesis result. No model weights have been loaded or executed, and no voice is approved for public hosted deployment.

## Findings

| Candidate | Native artifacts/configuration | Local experiment | Commercial audio output | Redistribution / hosted use | Disposition |
| --- | --- | --- | --- | --- | --- |
| Printto V5 Pure / Commercial Pack | Owner page and terms inspected; exact archive contents/native checkpoints not established. Download is behind an agreement step, which was not accepted | Subject to archive terms; not evaluated | Owner permits commercial vocals subject to character/name conditions | Repackaging/redistribution requires permission; hosted inference not established | Not yet eligible for the native adapter; do not assume a ready PyTorch release |
| Qixuan v2.7.0 | GitHub release and ZIP central directory inspected with a byte-range request. Package contains acoustic, duration, linguistic, pitch and variance `.onnx` files plus dsconfig/dictionaries. No `.ckpt` in the inspected package listing | Not attempted | Not determined here; release carries separate terms | Not determined here | Reject this distributed package for the user-selected native PyTorch path; no claim about privately held checkpoints |
| OpenVPI v1.5.0 `0116_female_triplet_ds1000.zip` | Official pretrained reference archive advertised, 735,624,616 bytes; requires compatible older code/config and native vocoder. Archive contents/model loading not verified | Candidate for a separately agreed non-commercial reference experiment; full compatibility not established | Official release explicitly prohibits any commercial usage and specifies speaker attribution | Redistribution must retain the release notice; not suitable as a commercial service default | User authorized non-commercial Demo evaluation; reference archive acquisition in progress, not a commercial default |
| OpenVPI v1.7.0 `0218_opencpop_ds1000_velocity.zip` / `0223_opencpop_ds1000_joint_aug.zip` | Official pretrained acoustic archives advertised (736,900,094 / 735,106,595 bytes). Newer native variance checkpoints and modern config compatibility not established | Must resolve model-specific terms and compatible code before loading | Not established from the release metadata alone | No production permission inferred from the Apache code license | Research leads, not selected profiles |
| `fox7005/nyaru_diffsinger` | HF revision `db2ac35fc9b463dc9c1c9b7bb895496377f670dd` lists `config.yaml` and `model_ckpt_steps_322000.ckpt`. Config references legacy 24 kHz/80-bin/hop-128 code. No dictionary/vocoder/license supplied in the inspected file list | Not attempted; permission and full pipeline unestablished | No license established | No license established | Reject as an integration candidate until missing permission/materials are supplied |
| `karl-wang/Carl-timbre-diffsinger` | HF revision `d1bea344e786321d2411a7479510e78513bb88bb`; a ZIP is listed but archive contents not inspected | Not selected; card alone does not establish compatible pipeline | Card states CC BY-NC-ND 4.0 | Do not infer hosted/commercial permission | Not a production fallback |
| Potluck v100 `finetune_assets.zip` | ZIP central directory confirms `checkpoints/potluck4finetune.ckpt` and two fine-tune configs. Archive 757,110,247 bytes; inference compatibility not yet tested | Terms cover DiffSinger usage; exact config still needs validation | Custom terms permit commercial use with DiffSinger, with attribution | Terms allow distribution/adaptation with conditions; prohibit using weights/output to assist generative-model training | Native vocoder lead, not a complete singing voice; no training is planned |

The absence of a public native voice in this inspected set is not evidence that no suitable voice exists elsewhere. Conversely, a native vocoder alone cannot sing lyrics or replace the acoustic/variance models. Do not use a model-card code license to relicense weights or training data.

## Sources

- [OpenVPI releases](https://github.com/openvpi/DiffSinger/releases), specifically [v1.5.0](https://github.com/openvpi/DiffSinger/releases/tag/v1.5.0) and [v1.7.0](https://github.com/openvpi/DiffSinger/releases/tag/v1.7.0).
- [Printto terms](https://printmov.com/commercial-pack).
- [Qixuan v2.7.0](https://github.com/yqzhishen/qixuan-diffsinger/releases/tag/v2.7.0).
- [Potluck v100](https://github.com/mrtigermeat/potluck-vocoder/releases/tag/v100), [Potluck license](https://github.com/mrtigermeat/potluck-vocoder/blob/main/LICENSE).
- [Nyaru file metadata](https://huggingface.co/fox7005/nyaru_diffsinger/tree/main), [Carl metadata](https://huggingface.co/karl-wang/Carl-timbre-diffsinger/tree/main).
- [OpenCpop owner page](https://wenet-e2e.github.io/opencpop/): training corpus rights are separate from engine code rights.

## Evidence digests

Retrieved source bytes and manifest are under ignored `data/models/screening/`. The digests below identify those metadata/config/terms captures, **not model-weight hashes**. Model-weight hashes remain unavailable until an eligible archive is actually downloaded. ZIP directory probes downloaded only the last 128 KiB, not the full model archives.

| Capture | SHA-256 |
| --- | --- |
| openvpi-releases | `126b99a5e3d1f87451e6ee1c017a3d71e4a4c7ac6ca7755e51025cc16995da6f` |
| qixuan-release | `5bcc2d918bbdf773bb9056dfb2b6090d16d95bdc57cc6106db61af607ca7472a` |
| potluck-release | `d3956718a9d5c745bf833210623169dce302e5a84bdd9bc06e89e7328b082fef` |
| potluck-license | `5b3da863d2d3293f41b1b5fa600ceeb9805852ab562962fd7ba09ae15c49664e` |
| printto-terms | `b139de23c1818def98ba14850d99746317741723b77196f0ec92bc4254e2e178` |
| nyaru-metadata | `fedfd43f7a3269532a07e957167c0a040da35e7b281c32bc42a6d94dfd71df0f` |
| nyaru-config | `e74ab7f120c7db0952a9378e9bcaa80fc2439345ae148c7c62500cb447a3bf73` |
| carl-metadata | `5cf1d37733d194e537209265a0f38cccffcdd1be45216e7710850445fb851b30` |
| opencpop-home | `b1c4e216274583cd228f1c773256e6e1d427daf9e9d17eca3329412ac9ec4165` |

## Execution boundary

Task 1.1 is complete as a candidate/terms inventory. Task 1.2 is not complete: no full profile has passed native checkpoint loading, configuration compatibility and the selected intended-use check. Tasks 1.3 onward are not started. No audio demo, quality measurement or latency result exists yet.

The user approved non-commercial models for this Demo on 2026-11-04. Proceed with the official non-commercial reference experiment, keeping production voice selection separate. No ONNX fallback, model training, permission request to an owner, agreement acceptance or commercial hosting has been substituted for the chosen scope.
